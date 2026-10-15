import { Router } from 'express';
import { getDb, newId, nowIso } from '../lib/database';
import { requireUser } from '../lib/session';
import { q } from '../lib/query';

type DailyReportItemInput = { project_id: string; content: string };

export const dailyReportsRouter = Router();

function itemsOf(reportId: string) {
  const db = getDb();
  const items = db
    .prepare(
      `SELECT ri.id, ri.report_id, ri.project_id, ri.content, ri.created_at,
              p.name AS project_name, p.code AS project_code, p.description AS project_description
       FROM report_items ri LEFT JOIN projects p ON p.id = ri.project_id
       WHERE ri.report_id = ? ORDER BY ri.created_at ASC`,
    )
    .all(reportId) as Record<string, unknown>[];
  return items.map((it) => ({
    id: it.id,
    report_id: it.report_id,
    project_id: it.project_id,
    content: it.content,
    created_at: it.created_at,
    projects: it.project_id
      ? {
          id: it.project_id,
          name: it.project_name,
          code: it.project_code,
          description: it.project_description,
        }
      : null,
  }));
}

function ownedReport(id: string, userId: string) {
  return getDb().prepare('SELECT * FROM daily_reports WHERE id = ? AND user_id = ?').get(id, userId) as
    | Record<string, unknown>
    | undefined;
}

/** 日报写入后更新用户最近编辑时间（替代原 Postgres 触发器）。 */
function touchReportEdit(userId: string) {
  const now = nowIso();
  getDb()
    .prepare('UPDATE user_profiles SET last_report_edit_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, userId);
}

// 列表：?date=yyyy-mm-dd 查单日；?start=&end= 查区间；?with_items=1 附带明细（含项目信息）
dailyReportsRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const date = q(req, 'date');
    const start = q(req, 'start');
    const end = q(req, 'end');
    const withItems = q(req, 'with_items') === '1';

    const db = getDb();
    let rows: Record<string, unknown>[];
    if (date) {
      rows = db.prepare('SELECT * FROM daily_reports WHERE user_id = ? AND date = ?').all(user.id, date) as Record<
        string,
        unknown
      >[];
    } else if (start && end) {
      rows = db
        .prepare('SELECT * FROM daily_reports WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC')
        .all(user.id, start, end) as Record<string, unknown>[];
    } else if (start) {
      rows = db.prepare('SELECT * FROM daily_reports WHERE user_id = ? AND date >= ? ORDER BY date DESC').all(
        user.id,
        start,
      ) as Record<string, unknown>[];
    } else {
      rows = db.prepare('SELECT * FROM daily_reports WHERE user_id = ? ORDER BY date DESC LIMIT 100').all(
        user.id,
      ) as Record<string, unknown>[];
    }

    const reports = rows.map((r) => {
      const report = { ...r };
      return withItems ? { ...report, report_items: itemsOf(r.id as string) } : report;
    });
    return res.json({ reports, total: reports.length });
  } catch (error) {
    console.error('获取日报列表失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 新建或全量保存（按 user_id+date upsert，items 全量替换）
dailyReportsRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const body = req.body as {
      date?: string;
      items?: DailyReportItemInput[];
    };
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return res.status(400).json({ error: '日期格式不正确' });
    }
    const items = (body.items || []).filter((it) => it.project_id && (it.content || '').trim());
    if (items.length === 0) {
      return res.status(400).json({ error: '日报内容不能为空' });
    }

    const db = getDb();
    // 项目归属校验
    const projectIds = Array.from(new Set(items.map((it) => it.project_id)));
    const placeholders = projectIds.map(() => '?').join(',');
    const owned = db.prepare(`SELECT id FROM projects WHERE user_id = ? AND id IN (${placeholders})`).all(
      user.id,
      ...projectIds,
    ) as Array<{ id: string }>;
    if (owned.length !== projectIds.length) {
      return res.status(403).json({ error: '包含不属于你的项目' });
    }

    const now = nowIso();
    let report = db.prepare('SELECT * FROM daily_reports WHERE user_id = ? AND date = ?').get(user.id, body.date) as
      | Record<string, unknown>
      | undefined;

    db.exec('BEGIN');
    try {
      if (report) {
        db.prepare('UPDATE daily_reports SET updated_at = ? WHERE id = ?').run(now, report.id);
        db.prepare('DELETE FROM report_items WHERE report_id = ?').run(report.id);
      } else {
        const id = newId();
        db.prepare('INSERT INTO daily_reports (id, user_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
          id,
          user.id,
          body.date,
          now,
          now,
        );
        report = { id, user_id: user.id, date: body.date, created_at: now, updated_at: now };
      }
      const stmt = db.prepare(
        'INSERT INTO report_items (id, report_id, project_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const it of items) {
        stmt.run(newId(), report.id, it.project_id, it.content.trim(), now, now);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    touchReportEdit(user.id);
    const saved = {
      ...(db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(report.id) as Record<
        string,
        unknown
      >),
    };
    return res
      .status(201)
      .json({ report: { ...saved, report_items: itemsOf(report.id as string) }, message: '日报保存成功' });
  } catch (error) {
    console.error('保存日报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

dailyReportsRouter.delete('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = ownedReport(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '日报不存在' });
    const db = getDb();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM report_items WHERE report_id = ?').run(req.params.id);
      db.prepare('DELETE FROM daily_reports WHERE id = ?').run(req.params.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    touchReportEdit(user.id);
    return res.json({ message: '日报删除成功' });
  } catch (error) {
    console.error('删除日报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});
