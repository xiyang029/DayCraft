import { Router } from 'express';
import { getDb, mapBooleans, newId, nowIso, toInt } from '../lib/database';
import { requireUser } from '../lib/session';
import { touchReportEdit } from '../lib/report-helpers';

type DailyReportItemInput = { project_id: string; content: string };

export const dailyReportsRouter = Router();
export const reportItemsRouter = Router();

function toReport(row: Record<string, unknown>) {
  return mapBooleans({ ...row }, ['is_plan']);
}

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

// 列表：?date=yyyy-mm-dd 查单日；?start=&end= 查区间；?with_items=1 附带明细（含项目信息）
dailyReportsRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const q = (n: string): string | undefined => {
      const v = req.query[n];
      return Array.isArray(v) ? String(v[0]) : (v as string | undefined);
    };
    const date = q('date');
    const start = q('start');
    const end = q('end');
    const withItems = q('with_items') === '1';

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
      const report = toReport(r);
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
      is_plan?: boolean;
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
        db.prepare('UPDATE daily_reports SET is_plan = ?, updated_at = ? WHERE id = ?').run(
          toInt(body.is_plan),
          now,
          report.id,
        );
        db.prepare('DELETE FROM report_items WHERE report_id = ?').run(report.id);
      } else {
        const id = newId();
        db.prepare(
          'INSERT INTO daily_reports (id, user_id, date, created_at, updated_at, is_plan) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, user.id, body.date, now, now, toInt(body.is_plan));
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
    const saved = toReport(db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(report.id) as Record<
      string,
      unknown
    >);
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

// 全量更新：{is_plan, items}（items 全量替换）
dailyReportsRouter.put('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = ownedReport(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '日报不存在' });

    const body = req.body as { is_plan?: boolean; items?: DailyReportItemInput[] };
    const db = getDb();
    const now = nowIso();

    db.exec('BEGIN');
    try {
      if (body.is_plan !== undefined) {
        db.prepare('UPDATE daily_reports SET is_plan = ?, updated_at = ? WHERE id = ?').run(
          toInt(body.is_plan),
          now,
          req.params.id,
        );
      } else {
        db.prepare('UPDATE daily_reports SET updated_at = ? WHERE id = ?').run(now, req.params.id);
      }
      if (body.items !== undefined) {
        const items = body.items.filter((it) => it.project_id && (it.content || '').trim());
        const projectIds = Array.from(new Set(items.map((it) => it.project_id)));
        if (projectIds.length > 0) {
          const placeholders = projectIds.map(() => '?').join(',');
          const ownedProjects = db
            .prepare(`SELECT id FROM projects WHERE user_id = ? AND id IN (${placeholders})`)
            .all(user.id, ...projectIds) as Array<{ id: string }>;
          if (ownedProjects.length !== projectIds.length) {
            db.exec('ROLLBACK');
            return res.status(403).json({ error: '包含不属于你的项目' });
          }
        }
        db.prepare('DELETE FROM report_items WHERE report_id = ?').run(req.params.id);
        const stmt = db.prepare(
          'INSERT INTO report_items (id, report_id, project_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        );
        for (const it of items) {
          stmt.run(newId(), req.params.id, it.project_id, it.content.trim(), now, now);
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    touchReportEdit(user.id);
    return res.json({ message: '日报更新成功' });
  } catch (error) {
    console.error('更新日报失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 新增单条日报条目：{report_id} 或 {date, project_id, content}
// 传 date 时若当日日报不存在则自动创建（待办完成联动日报用）。
reportItemsRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const body = req.body as {
      report_id?: string;
      date?: string;
      project_id?: string;
      content?: string;
    };
    const content = (body.content || '').trim();
    if (!body.project_id || !content) {
      return res.status(400).json({ error: '项目与内容不能为空' });
    }

    const db = getDb();
    const project = db
      .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
      .get(body.project_id, user.id);
    if (!project) {
      return res.status(404).json({ error: '项目不存在' });
    }

    let reportId = body.report_id;
    if (reportId) {
      const report = db.prepare('SELECT id FROM daily_reports WHERE id = ? AND user_id = ?').get(reportId, user.id);
      if (!report) return res.status(404).json({ error: '日报不存在' });
    } else {
      const date = body.date || new Date().toISOString().slice(0, 10);
      const existing = db.prepare('SELECT id FROM daily_reports WHERE user_id = ? AND date = ?').get(user.id, date) as
        | { id: string }
        | undefined;
      if (existing) {
        reportId = existing.id;
      } else {
        const now = nowIso();
        reportId = newId();
        db.prepare(
          'INSERT INTO daily_reports (id, user_id, date, created_at, updated_at, is_plan) VALUES (?, ?, ?, ?, ?, 0)',
        ).run(reportId, user.id, date, now, now);
      }
    }

    const now = nowIso();
    const id = newId();
    db.prepare(
      'INSERT INTO report_items (id, report_id, project_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, reportId, body.project_id, content, now, now);
    touchReportEdit(user.id);
    return res
      .status(201)
      .json({ item: { id, report_id: reportId, project_id: body.project_id, content, created_at: now } });
  } catch (error) {
    console.error('新增日报条目失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

reportItemsRouter.delete('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const db = getDb();
    const row = db
      .prepare(
        `SELECT ri.id FROM report_items ri
         JOIN daily_reports dr ON dr.id = ri.report_id
         WHERE ri.id = ? AND dr.user_id = ?`,
      )
      .get(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '日报条目不存在' });

    db.prepare('DELETE FROM report_items WHERE id = ?').run(req.params.id);
    touchReportEdit(user.id);
    return res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除日报条目失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});
