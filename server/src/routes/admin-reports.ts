import { Router } from 'express';
import { getDb } from '../lib/database';
import { requireAdmin } from '../lib/session';
import { q } from '../lib/query';

/**
 * 管理员全员报告视图（供 3D 星图与明细面板使用）。
 * 挂载在 /api/admin/reports 下，所有接口都要求管理员权限。
 */
const router = Router();

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** 默认统计区间：最近 30 天（含今天）。 */
function rangeOf(req: Parameters<typeof q>[0]): { start: string; end: string } {
  const today = new Date();
  const endRaw = q(req, 'end');
  const startRaw = q(req, 'start');
  const end = endRaw && /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : toDateStr(today);
  const start =
    startRaw && /^\d{4}-\d{2}-\d{2}$/.test(startRaw)
      ? startRaw
      : toDateStr(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000));
  return { start, end };
}

function limitOf(req: Parameters<typeof q>[0], fallback = 300): number {
  const raw = Number(q(req, 'limit'));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), 1000);
}

function parseRoles(role: unknown): string[] {
  if (typeof role !== 'string') return ['user'];
  try {
    const parsed = JSON.parse(role) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : ['user'];
  } catch {
    return ['user'];
  }
}

function parseItems(items: Record<string, unknown>[]): unknown[] {
  return items.map((it) => ({
    id: it.id,
    report_id: it.report_id,
    project_id: it.project_id,
    content: it.content,
    created_at: it.created_at,
    projects: it.project_id
      ? { id: it.project_id, name: it.project_name, code: it.project_code }
      : null,
  }));
}

function itemsOf(reportId: string): unknown[] {
  const rows = getDb()
    .prepare(
      `SELECT ri.id, ri.report_id, ri.project_id, ri.content, ri.created_at,
              p.name AS project_name, p.code AS project_code
       FROM report_items ri LEFT JOIN projects p ON p.id = ri.project_id
       WHERE ri.report_id = ? ORDER BY ri.created_at ASC`,
    )
    .all(reportId) as Record<string, unknown>[];
  return parseItems(rows);
}

// 星图数据：人员、项目与「人员在项目上写过日报」的关联边
router.get('/graph', async (req, res) => {
  try {
    const checked = await requireAdmin(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const { start, end } = rangeOf(req);
    const db = getDb();

    const profiles = db
      .prepare('SELECT id, full_name, email, role, created_at, last_report_edit_at FROM user_profiles ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;

    const dailyRows = db
      .prepare(
        `SELECT user_id, COUNT(*) AS cnt, MAX(date) AS last_date
         FROM daily_reports WHERE date >= ? AND date <= ? GROUP BY user_id`,
      )
      .all(start, end) as Array<{ user_id: string; cnt: number; last_date: string }>;

    const itemRows = db
      .prepare(
        `SELECT dr.user_id AS user_id, COUNT(*) AS cnt
         FROM report_items ri JOIN daily_reports dr ON dr.id = ri.report_id
         WHERE dr.date >= ? AND dr.date <= ? GROUP BY dr.user_id`,
      )
      .all(start, end) as Array<{ user_id: string; cnt: number }>;

    const weeklyRows = db
      .prepare(
        `SELECT user_id, COUNT(*) AS cnt FROM weekly_reports
         WHERE start_date <= ? AND end_date >= ? GROUP BY user_id`,
      )
      .all(end, start) as Array<{ user_id: string; cnt: number }>;

    const monthlyRows = db
      .prepare(
        `SELECT user_id, COUNT(*) AS cnt FROM monthly_reports
         WHERE start_date <= ? AND end_date >= ? GROUP BY user_id`,
      )
      .all(end, start) as Array<{ user_id: string; cnt: number }>;

    const projectRows = db
      .prepare('SELECT id, name, code, user_id, is_active FROM projects ORDER BY created_at ASC')
      .all() as Array<{ id: string; name: string; code: string; user_id: string; is_active: number }>;

    const linkRows = db
      .prepare(
        `SELECT ri.project_id AS project_id, dr.user_id AS user_id, COUNT(*) AS cnt, MAX(dr.date) AS last_date
         FROM report_items ri JOIN daily_reports dr ON dr.id = ri.report_id
         WHERE dr.date >= ? AND dr.date <= ?
         GROUP BY ri.project_id, dr.user_id`,
      )
      .all(start, end) as Array<{ project_id: string; user_id: string; cnt: number; last_date: string }>;

    const dailyMap = new Map(dailyRows.map((r) => [r.user_id, r]));
    const itemMap = new Map(itemRows.map((r) => [r.user_id, Number(r.cnt)]));
    const weeklyMap = new Map(weeklyRows.map((r) => [r.user_id, Number(r.cnt)]));
    const monthlyMap = new Map(monthlyRows.map((r) => [r.user_id, Number(r.cnt)]));

    const projectStats = new Map<string, { item_count: number; members: Set<string>; last_date: string | null }>();
    for (const link of linkRows) {
      const entry = projectStats.get(link.project_id) ?? { item_count: 0, members: new Set<string>(), last_date: null };
      entry.item_count += Number(link.cnt);
      entry.members.add(link.user_id);
      if (!entry.last_date || link.last_date > entry.last_date) entry.last_date = link.last_date;
      projectStats.set(link.project_id, entry);
    }

    const members = profiles.map((p) => {
      const id = p.id as string;
      const daily = dailyMap.get(id);
      return {
        id,
        name: (p.full_name as string) || (p.email as string)?.split('@')[0] || '用户',
        email: (p.email as string) || '',
        role: parseRoles(p.role),
        last_report_edit_at: p.last_report_edit_at ?? null,
        daily_count: daily ? Number(daily.cnt) : 0,
        item_count: itemMap.get(id) ?? 0,
        weekly_count: weeklyMap.get(id) ?? 0,
        monthly_count: monthlyMap.get(id) ?? 0,
        last_date: daily?.last_date ?? null,
      };
    });

    const ownerNames = new Map(members.map((m) => [m.id, m.name]));
    const projects = projectRows.map((p) => {
      const stats = projectStats.get(p.id);
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        is_active: Number(p.is_active) === 1,
        owner_id: p.user_id,
        owner_name: ownerNames.get(p.user_id) ?? '未知',
        item_count: stats?.item_count ?? 0,
        member_count: stats?.members.size ?? 0,
        last_date: stats?.last_date ?? null,
      };
    });

    return res.json({
      range: { start, end },
      members,
      projects,
      links: linkRows.map((l) => ({
        user_id: l.user_id,
        project_id: l.project_id,
        item_count: Number(l.cnt),
        last_date: l.last_date,
      })),
      totals: {
        members: members.length,
        projects: projects.length,
        daily_reports: dailyRows.reduce((sum, r) => sum + Number(r.cnt), 0),
        items: itemRows.reduce((sum, r) => sum + Number(r.cnt), 0),
      },
    });
  } catch (error) {
    console.error('获取团队报告星图失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 全员日报明细：可按人员或项目过滤（点击项目球时用 project_id）
router.get('/daily', async (req, res) => {
  try {
    const checked = await requireAdmin(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const { start, end } = rangeOf(req);
    const userId = q(req, 'user_id');
    const projectId = q(req, 'project_id');
    const withItems = q(req, 'with_items') !== '0';
    const limit = limitOf(req);

    const db = getDb();
    const conditions = ['dr.date >= ?', 'dr.date <= ?'];
    const params: (string | number)[] = [start, end];
    if (userId) {
      conditions.push('dr.user_id = ?');
      params.push(userId);
    }
    if (projectId) {
      conditions.push('EXISTS (SELECT 1 FROM report_items ri WHERE ri.report_id = dr.id AND ri.project_id = ?)');
      params.push(projectId);
    }

    const rows = db
      .prepare(
        `SELECT dr.id, dr.user_id, dr.date, dr.created_at, dr.updated_at,
                up.full_name, up.email
         FROM daily_reports dr LEFT JOIN user_profiles up ON up.id = dr.user_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY dr.date DESC, up.full_name ASC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, unknown>>;

    const reports = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      user_name: (r.full_name as string) || (r.email as string)?.split('@')[0] || '用户',
      user_email: (r.email as string) || '',
      date: r.date,
      created_at: r.created_at,
      updated_at: r.updated_at,
      items: withItems ? itemsOf(r.id as string) : [],
    }));

    return res.json({ range: { start, end }, reports, total: reports.length });
  } catch (error) {
    console.error('获取全员日报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 全员周报 / 月报
router.get('/weekly', async (req, res) => {
  try {
    const checked = await requireAdmin(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const { start, end } = rangeOf(req);
    const kind = q(req, 'kind') || 'weekly';
    const userId = q(req, 'user_id');
    const limit = limitOf(req);
    const db = getDb();

    if (kind === 'monthly') {
      const conditions = ['mr.start_date <= ?', 'mr.end_date >= ?'];
      const params: (string | number)[] = [end, start];
      if (userId) {
        conditions.push('mr.user_id = ?');
        params.push(userId);
      }
      const rows = db
        .prepare(
          `SELECT mr.*, up.full_name, up.email
           FROM monthly_reports mr LEFT JOIN user_profiles up ON up.id = mr.user_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY mr.year DESC, mr.month DESC LIMIT ?`,
        )
        .all(...params, limit) as Array<Record<string, unknown>>;
      return res.json({
        kind,
        range: { start, end },
        reports: rows.map((r) => ({
          id: r.id,
          user_id: r.user_id,
          user_name: (r.full_name as string) || (r.email as string)?.split('@')[0] || '用户',
          year: r.year,
          month: r.month,
          start_date: r.start_date,
          end_date: r.end_date,
          content: r.content,
          status: r.status,
          updated_at: r.updated_at,
        })),
        total: rows.length,
      });
    }

    const conditions = ['wr.start_date <= ?', 'wr.end_date >= ?'];
    const params: (string | number)[] = [end, start];
    if (userId) {
      conditions.push('wr.user_id = ?');
      params.push(userId);
    }
    const rows = db
      .prepare(
        `SELECT wr.*, up.full_name, up.email
         FROM weekly_reports wr LEFT JOIN user_profiles up ON up.id = wr.user_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY wr.year DESC, wr.week_number DESC LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, unknown>>;

    return res.json({
      kind: 'weekly',
      range: { start, end },
      reports: rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user_name: (r.full_name as string) || (r.email as string)?.split('@')[0] || '用户',
        year: r.year,
        week_number: r.week_number,
        start_date: r.start_date,
        end_date: r.end_date,
        content: r.content,
        status: r.status,
        updated_at: r.updated_at,
      })),
      total: rows.length,
    });
  } catch (error) {
    console.error('获取全员周报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
