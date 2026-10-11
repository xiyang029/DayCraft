import { Router } from 'express';
import { getDb, mapBooleans, newId, nowIso, toInt } from '../lib/database';
import { requireUser } from '../lib/session';
import type { Project } from '../lib/types';

const router = Router();

function toProject(row: Record<string, unknown>): Project {
  return mapBooleans({ ...row }, ['is_active']) as unknown as Project;
}

function owned(id: string, userId: string) {
  return getDb().prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as
    | Record<string, unknown>
    | undefined;
}

// 获取当前用户的项目列表
router.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const q = (n: string): string | undefined => {
      const v = req.query[n];
      return Array.isArray(v) ? String(v[0]) : (v as string | undefined);
    };
    const activeOnly = q('active_only') === 'true';

    const db = getDb();
    const rows = (
      activeOnly
        ? db
            .prepare(
              'SELECT id, name, code, description, user_id, created_at, updated_at, is_active FROM projects WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
            )
            .all(user.id)
        : db
            .prepare(
              'SELECT id, name, code, description, user_id, created_at, updated_at, is_active FROM projects WHERE user_id = ? ORDER BY created_at DESC',
            )
            .all(user.id)
    ) as Record<string, unknown>[];

    const projects = rows.map(toProject);
    return res.json({ projects, total: projects.length });
  } catch (error) {
    console.error('获取项目列表失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 创建新项目
router.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;

    const body = req.body as {
      name?: string;
      code?: string;
      description?: string;
      is_active?: boolean;
    };
    const name = (body.name || '').trim();
    const code = (body.code || '').trim();
    const description = (body.description || '').trim() || null;

    if (!name) {
      return res.status(400).json({ error: '项目名称不能为空' });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: '项目名称不能超过100个字符' });
    }
    if (code && code.length > 50) {
      return res.status(400).json({ error: '项目编码不能超过50个字符' });
    }
    if (body.description && body.description.length > 500) {
      return res.status(400).json({ error: '项目描述不能超过500个字符' });
    }

    const db = getDb();
    const dupName = db.prepare('SELECT id FROM projects WHERE user_id = ? AND name = ?').get(user.id, name);
    if (dupName) {
      return res.status(400).json({ error: '项目名称已存在' });
    }
    if (code) {
      const dupCode = db.prepare('SELECT id FROM projects WHERE user_id = ? AND code = ?').get(user.id, code);
      if (dupCode) {
        return res.status(400).json({ error: '项目编码已存在' });
      }
    }

    const now = nowIso();
    const id = newId();
    db.prepare(
      'INSERT INTO projects (id, name, code, description, user_id, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, name, code || null, description, user.id, now, now, toInt(body.is_active, 1));

    const project = toProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>);
    return res.status(201).json({ project, message: '项目创建成功' });
  } catch (error) {
    console.error('创建项目失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = owned(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '项目不存在' });
    return res.json({ project: toProject(row) });
  } catch (error) {
    console.error('获取项目失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = owned(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '项目不存在' });

    const body = req.body as {
      name?: string;
      code?: string;
      description?: string | null;
      is_active?: boolean;
    };
    const db = getDb();

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return res.status(400).json({ error: '项目名称不能为空' });
      if (name.length > 100) return res.status(400).json({ error: '项目名称不能超过100个字符' });
      const dup = db
        .prepare('SELECT id FROM projects WHERE user_id = ? AND name = ? AND id != ?')
        .get(user.id, name, req.params.id);
      if (dup) return res.status(400).json({ error: '项目名称已存在' });
    }
    if (body.code !== undefined && body.code) {
      const code = body.code.trim();
      if (code.length > 50) return res.status(400).json({ error: '项目编码不能超过50个字符' });
      const dup = db
        .prepare('SELECT id FROM projects WHERE user_id = ? AND code = ? AND id != ?')
        .get(user.id, code, req.params.id);
      if (dup) return res.status(400).json({ error: '项目编码已存在' });
    }
    if (body.description !== undefined && body.description && body.description.length > 500) {
      return res.status(400).json({ error: '项目描述不能超过500个字符' });
    }

    const next = {
      name: body.name !== undefined ? body.name.trim() : (row.name as string),
      code: body.code !== undefined ? body.code.trim() || null : (row.code as string),
      description:
        body.description !== undefined ? body.description?.trim() || null : (row.description as string | null),
      is_active: body.is_active !== undefined ? toInt(body.is_active) : (row.is_active as number),
    };
    db.prepare(
      'UPDATE projects SET name = ?, code = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?',
    ).run(next.name, next.code, next.description, next.is_active, nowIso(), req.params.id);
    const updated = toProject(
      db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as Record<string, unknown>,
    );
    return res.json({ project: updated, message: '项目更新成功' });
  } catch (error) {
    console.error('更新项目失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const row = owned(req.params.id, user.id);
    if (!row) return res.status(404).json({ error: '项目不存在' });
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    return res.json({ message: '项目删除成功' });
  } catch (error) {
    console.error('删除项目失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
