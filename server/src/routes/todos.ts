import { Router } from 'express';
import { getDb, newId, nowIso } from '../lib/database';
import { requireUser } from '../lib/session';

const router = Router();

const PRIORITIES = ['high', 'medium', 'low'];
const STATUSES = ['not_started', 'in_progress', 'completed'];

function owned(id: string, userId: string) {
  return getDb().prepare('SELECT * FROM project_todos WHERE id = ? AND user_id = ?').get(id, userId) as
    | Record<string, unknown>
    | undefined;
}

// 列表：?project_id=&status=active|completed&limit=
router.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const q = (n: string): string | undefined => {
      const v = req.query[n];
      return Array.isArray(v) ? String(v[0]) : (v as string | undefined);
    };
    const projectId = q('project_id');
    const status = q('status');
    const limit = Number(q('limit') || 0);

    const conds = ['t.user_id = ?'];
    const args: unknown[] = [user.id];
    if (projectId) {
      conds.push('t.project_id = ?');
      args.push(projectId);
    }
    let order = 't.due_date ASC';
    if (status === 'completed') {
      conds.push("t.status = 'completed'");
      order = 't.completed_at DESC';
    } else if (status === 'active') {
      conds.push("t.status != 'completed'");
    } else if (status) {
      conds.push('t.status = ?');
      args.push(status);
    }

    const db = getDb();
    let sql = `SELECT t.id, t.user_id, t.project_id, t.content, t.priority, t.due_date, t.status,
             t.completed_at, t.created_at, t.updated_at,
             p.name AS project_name, p.code AS project_code
       FROM project_todos t LEFT JOIN projects p ON p.id = t.project_id
       WHERE ${conds.join(' AND ')} ORDER BY ${order}`;
    if (limit > 0) sql += ` LIMIT ${Math.floor(limit)}`;
    const rows = db.prepare(sql).all(...args) as Record<string, unknown>[];
    const todos = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      project_id: r.project_id,
      content: r.content,
      priority: r.priority,
      due_date: r.due_date,
      status: r.status,
      completed_at: r.completed_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      project: r.project_id ? { id: r.project_id, name: r.project_name, code: r.project_code } : null,
    }));
    return res.json({ todos, total: todos.length });
  } catch (error) {
    console.error('获取待办列表失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const body = req.body as {
      project_id?: string;
      content?: string;
      priority?: string;
      due_date?: string;
      status?: string;
    };
    const content = (body.content || '').trim();
    if (!body.project_id) return res.status(400).json({ error: '请选择项目' });
    if (!content) return res.status(400).json({ error: '待办内容不能为空' });
    if (body.priority && !PRIORITIES.includes(body.priority)) {
      return res.status(400).json({ error: '优先级不正确' });
    }
    if (body.status && !STATUSES.includes(body.status)) {
      return res.status(400).json({ error: '状态不正确' });
    }
    if (!body.due_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) {
      return res.status(400).json({ error: '截止日期格式不正确' });
    }

    const db = getDb();
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(body.project_id, user.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const now = nowIso();
    const id = newId();
    const status = body.status || 'not_started';
    const completedAt = status === 'completed' ? now : null;
    db.prepare(
      `INSERT INTO project_todos (id, user_id, project_id, content, priority, due_date, status, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, user.id, body.project_id, content, body.priority || 'medium', body.due_date, status, completedAt, now, now);

    const todo = db.prepare('SELECT * FROM project_todos WHERE id = ?').get(id);
    return res.status(201).json({ todo, message: '待办创建成功' });
  } catch (error) {
    console.error('创建待办失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = owned(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '待办不存在' });
    return res.json({ todo: row });
  } catch (error) {
    console.error('获取待办失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = owned(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '待办不存在' });

    const body = req.body as {
      content?: string;
      priority?: string;
      due_date?: string;
      status?: string;
      completed_at?: string | null;
    };
    if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) {
      return res.status(400).json({ error: '优先级不正确' });
    }
    if (body.status !== undefined && !STATUSES.includes(body.status)) {
      return res.status(400).json({ error: '状态不正确' });
    }

    const next = {
      content: body.content !== undefined ? body.content.trim() : (row.content as string),
      priority: body.priority ?? (row.priority as string),
      due_date: body.due_date ?? (row.due_date as string),
      status: body.status ?? (row.status as string),
      completed_at:
        body.completed_at !== undefined
          ? body.completed_at
          : body.status === 'completed'
            ? nowIso()
            : body.status !== undefined
              ? null
              : (row.completed_at as string | null),
    };
    if (!next.content) return res.status(400).json({ error: '待办内容不能为空' });

    getDb()
      .prepare(
        'UPDATE project_todos SET content = ?, priority = ?, due_date = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(next.content, next.priority, next.due_date, next.status, next.completed_at, nowIso(), req.params.id);
    const updated = getDb().prepare('SELECT * FROM project_todos WHERE id = ?').get(req.params.id);
    return res.json({ todo: updated, message: '待办更新成功' });
  } catch (error) {
    console.error('更新待办失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = owned(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '待办不存在' });
    getDb().prepare('DELETE FROM project_todos WHERE id = ?').run(req.params.id);
    return res.json({ message: '待办删除成功' });
  } catch (error) {
    console.error('删除待办失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
