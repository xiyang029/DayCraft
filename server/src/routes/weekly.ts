import { Router } from 'express';
import { getDb, newId, nowIso } from '../lib/database';
import { requireUser } from '../lib/session';

export const weeklyRouter = Router();
export const monthlyRouter = Router();

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
