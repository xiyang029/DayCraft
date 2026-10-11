import { Router } from 'express';
import { getDb, mapBooleans, newId, nowIso, toInt } from '../lib/database';
import { requireUser } from '../lib/session';

function q(req: { query: unknown }, n: string): string | undefined {
  const query = req.query as Record<string, unknown>;
  const v = query[n];
  return Array.isArray(v) ? String(v[0]) : (v as string | undefined);
}

export const weeklyRouter = Router();
export const monthlyRouter = Router();
export const projectWeeklyRouter = Router();

// ---- weekly_reports ----
weeklyRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const rows = getDb()
      .prepare('SELECT * FROM weekly_reports WHERE user_id = ? ORDER BY year DESC, week_number DESC')
      .all(checked.user.id);
    return res.json({ reports: rows, total: (rows as unknown[]).length });
  } catch (error) {
    console.error('获取周报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

weeklyRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const body = req.body as {
      year?: number;
      week_number?: number;
      start_date?: string;
      end_date?: string;
      content?: string;
      status?: string;
    };
    if (!body.year || !body.week_number || !body.start_date || !body.end_date) {
      return res.status(400).json({ error: '缺少周报关键字段' });
    }
    if (!body.content || !body.content.trim()) {
      return res.status(400).json({ error: '周报内容不能为空' });
    }
    const status = body.status === 'draft' ? 'draft' : 'generated';
    const db = getDb();
    const now = nowIso();
    const existing = db
      .prepare('SELECT id FROM weekly_reports WHERE user_id = ? AND year = ? AND week_number = ?')
      .get(checked.user.id, body.year, body.week_number) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        'UPDATE weekly_reports SET start_date = ?, end_date = ?, content = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(body.start_date, body.end_date, body.content, status, now, existing.id);
      const report = db.prepare('SELECT * FROM weekly_reports WHERE id = ?').get(existing.id);
      return res.json({ report, message: '周报保存成功' });
    }
    const id = newId();
    db.prepare(
      'INSERT INTO weekly_reports (id, user_id, year, week_number, start_date, end_date, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      checked.user.id,
      body.year,
      body.week_number,
      body.start_date,
      body.end_date,
      body.content,
      status,
      now,
      now,
    );
    const report = db.prepare('SELECT * FROM weekly_reports WHERE id = ?').get(id);
    return res.status(201).json({ report, message: '周报保存成功' });
  } catch (error) {
    console.error('保存周报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- monthly_reports ----
monthlyRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const rows = getDb()
      .prepare('SELECT * FROM monthly_reports WHERE user_id = ? ORDER BY year DESC, month DESC')
      .all(checked.user.id);
    return res.json({ reports: rows, total: (rows as unknown[]).length });
  } catch (error) {
    console.error('获取月报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

monthlyRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const body = req.body as {
      year?: number;
      month?: number;
      start_date?: string;
      end_date?: string;
      content?: string;
      status?: string;
    };
    if (!body.year || !body.month || !body.start_date || !body.end_date) {
      return res.status(400).json({ error: '缺少月报关键字段' });
    }
    if (!body.content || !body.content.trim()) {
      return res.status(400).json({ error: '月报内容不能为空' });
    }
    const status = body.status === 'draft' ? 'draft' : 'generated';
    const db = getDb();
    const now = nowIso();
    const existing = db
      .prepare('SELECT id FROM monthly_reports WHERE user_id = ? AND year = ? AND month = ?')
      .get(checked.user.id, body.year, body.month) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        'UPDATE monthly_reports SET start_date = ?, end_date = ?, content = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(body.start_date, body.end_date, body.content, status, now, existing.id);
      const report = db.prepare('SELECT * FROM monthly_reports WHERE id = ?').get(existing.id);
      return res.json({ report, message: '月报保存成功' });
    }
    const id = newId();
    db.prepare(
      'INSERT INTO monthly_reports (id, user_id, year, month, start_date, end_date, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      checked.user.id,
      body.year,
      body.month,
      body.start_date,
      body.end_date,
      body.content,
      status,
      now,
      now,
    );
    const report = db.prepare('SELECT * FROM monthly_reports WHERE id = ?').get(id);
    return res.status(201).json({ report, message: '月报保存成功' });
  } catch (error) {
    console.error('保存月报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- project_weekly_reports ----
export type ProjectWeeklyItemInput = {
  project_id?: string | null;
  work_item_id?: string | null;
  content: string;
  project_name?: string | null;
  project_code?: string | null;
  work_item_name?: string | null;
  work_item_path?: string | null;
};

function toReport(row: Record<string, unknown>) {
  return mapBooleans({ ...row }, ['is_plan']);
}

function itemsOfReport(reportId: string) {
  const db = getDb();
  const items = db
    .prepare(
      `SELECT it.id, it.report_id, it.project_id, it.work_item_id, it.content,
              it.project_name, it.project_code, it.work_item_name, it.work_item_path,
              it.created_at, it.updated_at,
              p.name AS p_name, p.code AS p_code,
              wi.name AS wi_name, wi.level AS wi_level, wi.parent_id AS wi_parent_id
       FROM project_weekly_report_items it
       LEFT JOIN projects p ON p.id = it.project_id
       LEFT JOIN work_breakdown_items wi ON wi.id = it.work_item_id
       WHERE it.report_id = ? ORDER BY it.created_at ASC`,
    )
    .all(reportId) as Record<string, unknown>[];
  return items.map((it) => ({
    id: it.id,
    report_id: it.report_id,
    project_id: it.project_id,
    work_item_id: it.work_item_id,
    content: it.content,
    project_name: it.project_name,
    project_code: it.project_code,
    work_item_name: it.work_item_name,
    work_item_path: it.work_item_path,
    created_at: it.created_at,
    updated_at: it.updated_at,
    projects: it.project_id ? { id: it.project_id, name: it.p_name, code: it.p_code } : null,
    work_breakdown_items: it.work_item_id
      ? { id: it.work_item_id, name: it.wi_name, level: it.wi_level, parent_id: it.wi_parent_id }
      : null,
  }));
}

projectWeeklyRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const year = q(req, 'year');
    const week = q(req, 'week_number');
    const withItems = q(req, 'with_items') === '1';

    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM project_weekly_reports WHERE user_id = ? ORDER BY year DESC, week_number DESC')
      .all(checked.user.id) as Record<string, unknown>[];

    if (year && week) {
      const found = rows.find((r) => r.year === Number(year) && r.week_number === Number(week));
      if (!found) return res.json({ report: null });
      return res.json({ report: { ...toReport(found), items: itemsOfReport(found.id as string) } });
    }

    const reports = rows.map((r) =>
      withItems ? { ...toReport(r), items: itemsOfReport(r.id as string) } : toReport(r),
    );
    return res.json({ reports, total: reports.length });
  } catch (error) {
    console.error('获取项目周报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

projectWeeklyRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const body = req.body as {
      year?: number;
      week_number?: number;
      start_date?: string;
      end_date?: string;
      is_plan?: boolean;
      items?: ProjectWeeklyItemInput[];
    };
    if (!body.year || !body.week_number || !body.start_date || !body.end_date) {
      return res.status(400).json({ error: '缺少项目周报关键字段' });
    }
    const items = (body.items || []).filter((it) => (it.content || '').trim());

    const db = getDb();
    for (const it of items) {
      if (it.project_id) {
        const p = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(it.project_id, checked.user.id);
        if (!p) return res.status(403).json({ error: '包含不属于你的项目' });
      }
      if (it.work_item_id) {
        const w = db
          .prepare(
            'SELECT wi.id FROM work_breakdown_items wi JOIN projects p ON p.id = wi.project_id WHERE wi.id = ? AND p.user_id = ?',
          )
          .get(it.work_item_id, checked.user.id);
        if (!w) return res.status(403).json({ error: '包含不属于你的工作项' });
      }
    }

    const now = nowIso();
    let report = db
      .prepare('SELECT * FROM project_weekly_reports WHERE user_id = ? AND year = ? AND week_number = ?')
      .get(checked.user.id, body.year, body.week_number) as Record<string, unknown> | undefined;

    db.exec('BEGIN');
    try {
      if (report) {
        db.prepare(
          'UPDATE project_weekly_reports SET start_date = ?, end_date = ?, is_plan = ?, updated_at = ? WHERE id = ?',
        ).run(body.start_date, body.end_date, toInt(body.is_plan), now, report.id);
        db.prepare('DELETE FROM project_weekly_report_items WHERE report_id = ?').run(report.id);
      } else {
        const id = newId();
        db.prepare(
          'INSERT INTO project_weekly_reports (id, user_id, year, week_number, start_date, end_date, is_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          id,
          checked.user.id,
          body.year,
          body.week_number,
          body.start_date,
          body.end_date,
          toInt(body.is_plan),
          now,
          now,
        );
        report = { id };
      }
      const stmt = db.prepare(
        `INSERT INTO project_weekly_report_items (id, report_id, project_id, work_item_id, content, project_name, project_code, work_item_name, work_item_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const it of items) {
        stmt.run(
          newId(),
          report.id,
          it.project_id || null,
          it.work_item_id || null,
          it.content.trim(),
          it.project_name || null,
          it.project_code || null,
          it.work_item_name || null,
          it.work_item_path || null,
          now,
          now,
        );
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const saved = db.prepare('SELECT * FROM project_weekly_reports WHERE id = ?').get(report.id) as Record<
      string,
      unknown
    >;
    return res
      .status(201)
      .json({ report: { ...toReport(saved), items: itemsOfReport(report.id as string) }, message: '项目周报保存成功' });
  } catch (error) {
    console.error('保存项目周报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

projectWeeklyRouter.delete('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const id = req.params.id;
    const row = getDb()
      .prepare('SELECT * FROM project_weekly_reports WHERE id = ? AND user_id = ?')
      .get(id, checked.user.id) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ error: '项目周报不存在' });
    const db = getDb();
    db.prepare('DELETE FROM project_weekly_report_items WHERE report_id = ?').run(id);
    db.prepare('DELETE FROM project_weekly_reports WHERE id = ?').run(id);
    return res.json({ message: '项目周报删除成功' });
  } catch (error) {
    console.error('删除项目周报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});
