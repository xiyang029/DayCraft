import { Router } from 'express';
import { getDb, mapBooleans, newId, nowIso, toInt } from '../lib/database';
import { hashPassword, requireUser } from '../lib/session';
import { ownItem, ownProject, toWorkItem } from '../lib/work-items';
import type { WorkBreakdownItem } from '../lib/types';
import { generateShareToken } from '../lib/share';

function q(req: { query: unknown }, n: string): string | undefined {
  const query = req.query as Record<string, unknown>;
  const v = query[n];
  return Array.isArray(v) ? String(v[0]) : (v as string | undefined);
}

export const itemsRouter = Router();
export const wbShareRouter = Router();

const STATUSES = ['未开始', '进行中', '已暂停', '已完成'];

// ---- items: GET / POST / PUT（批量位置） ----
itemsRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const projectId = q(req, 'project_id');
    if (!projectId) return res.status(400).json({ error: '缺少 project_id' });
    if (!ownProject(projectId, checked.user.id)) {
      return res.status(404).json({ error: '项目不存在' });
    }

    const rows = getDb()
      .prepare('SELECT * FROM work_breakdown_items WHERE project_id = ? AND user_id = ? ORDER BY position ASC')
      .all(projectId, checked.user.id) as Record<string, unknown>[];
    return res.json({ items: rows.map(toWorkItem), total: rows.length });
  } catch (error) {
    console.error('获取工作项失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

itemsRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const body = req.body as Partial<WorkBreakdownItem> & { project_id?: string };
    if (!body.project_id || !ownProject(body.project_id, checked.user.id)) {
      return res.status(404).json({ error: '项目不存在' });
    }
    const name = (body.name || '').trim();
    if (!name) return res.status(400).json({ error: '工作项名称不能为空' });
    const level = Number(body.level ?? 0);
    if (!Number.isInteger(level) || level < 0 || level > 4) {
      return res.status(400).json({ error: '层级不正确' });
    }
    if (body.status && !STATUSES.includes(body.status)) {
      return res.status(400).json({ error: '状态不正确' });
    }
    if (body.parent_id) {
      const parent = getDb()
        .prepare('SELECT id FROM work_breakdown_items WHERE id = ? AND project_id = ?')
        .get(body.parent_id, body.project_id);
      if (!parent) return res.status(400).json({ error: '父级工作项不存在' });
    }

    const db = getDb();
    const now = nowIso();
    const id = newId();
    db.prepare(
      `INSERT INTO work_breakdown_items
        (id, project_id, name, description, parent_id, level, position, is_expanded, status, tags, members,
         progress_notes, planned_start_time, planned_end_time, actual_start_time, actual_end_time,
         is_milestone, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.project_id,
      name,
      (body.description || '').trim() || null,
      body.parent_id || null,
      level,
      Number(body.position ?? 0),
      toInt(body.is_expanded, 1),
      body.status || '未开始',
      body.tags || null,
      body.members || null,
      body.progress_notes || null,
      body.planned_start_time || null,
      body.planned_end_time || null,
      body.actual_start_time || null,
      body.actual_end_time || null,
      toInt(body.is_milestone),
      checked.user.id,
      now,
      now,
    );
    return res.status(201).json({ id });
  } catch (error) {
    console.error('创建工作项失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

itemsRouter.put('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const body = req.body as { updates?: Array<{ id: string; position: number }> };
    const updates = body.updates || [];
    const db = getDb();
    db.exec('BEGIN');
    try {
      const now = nowIso();
      for (const u of updates) {
        if (!ownItem(u.id, checked.user.id)) {
          db.exec('ROLLBACK');
          return res.status(403).json({ error: '包含不属于你的工作项' });
        }
        db.prepare('UPDATE work_breakdown_items SET position = ?, updated_at = ? WHERE id = ?').run(
          Number(u.position) || 0,
          now,
          u.id,
        );
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return res.json({ message: '位置更新成功' });
  } catch (error) {
    console.error('更新工作项位置失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- items/:id ----
const PATCHABLE = [
  'name',
  'description',
  'parent_id',
  'level',
  'position',
  'is_expanded',
  'status',
  'tags',
  'members',
  'progress_notes',
  'planned_start_time',
  'planned_end_time',
  'actual_start_time',
  'actual_end_time',
  'is_milestone',
];

itemsRouter.get('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const row = ownItem(req.params.id, checked.user.id);
    if (!row) return res.status(404).json({ error: '工作项不存在' });
    return res.json({ item: toWorkItem(row) });
  } catch (error) {
    console.error('获取工作项失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

itemsRouter.put('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const row = ownItem(req.params.id, checked.user.id);
    if (!row) return res.status(404).json({ error: '工作项不存在' });

    const body = req.body as Record<string, unknown>;
    const db = getDb();
    const sets: string[] = [];
    const args: unknown[] = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ error: '工作项名称不能为空' });
      sets.push('name = ?');
      args.push(name);
    }
    if (body.status !== undefined && body.status && !STATUSES.includes(String(body.status))) {
      return res.status(400).json({ error: '状态不正确' });
    }
    if (body.level !== undefined) {
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 0 || level > 4) {
        return res.status(400).json({ error: '层级不正确' });
      }
    }
    if (body.parent_id !== undefined && body.parent_id) {
      const parent = db
        .prepare('SELECT id FROM work_breakdown_items WHERE id = ? AND project_id = ?')
        .get(String(body.parent_id), row.project_id as string);
      if (!parent) return res.status(400).json({ error: '父级工作项不存在' });
    }

    for (const key of PATCHABLE) {
      if (body[key] === undefined || key === 'name' || key === 'status') continue;
      if (key === 'is_expanded' || key === 'is_milestone') {
        sets.push(`${key} = ?`);
        args.push(toInt(body[key] as boolean));
      } else if (key === 'parent_id') {
        sets.push('parent_id = ?');
        args.push(body[key] ? String(body[key]) : null);
      } else if (key === 'level' || key === 'position') {
        sets.push(`${key} = ?`);
        args.push(Number(body[key]) || 0);
      } else {
        const v = body[key];
        sets.push(`${key} = ?`);
        args.push(v === '' || v === undefined ? null : (v as string));
      }
    }
    if (body.status !== undefined) {
      sets.push('status = ?');
      args.push(String(body.status));
    }
    if (sets.length === 0) {
      return res.json({ item: toWorkItem(ownItem(req.params.id, checked.user.id)!) });
    }
    sets.push('updated_at = ?');
    args.push(nowIso(), req.params.id);
    db.prepare(`UPDATE work_breakdown_items SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return res.json({ item: toWorkItem(ownItem(req.params.id, checked.user.id)!) });
  } catch (error) {
    console.error('更新工作项失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

itemsRouter.delete('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const row = ownItem(req.params.id, checked.user.id);
    if (!row) return res.status(404).json({ error: '工作项不存在' });

    const db = getDb();
    db.prepare('DELETE FROM work_breakdown_items WHERE id = ?').run(req.params.id);
    const siblings = db
      .prepare(
        `SELECT id, position FROM work_breakdown_items
         WHERE project_id = ? AND ${row.parent_id ? 'parent_id = ?' : 'parent_id IS NULL'} AND position > ?
         ORDER BY position ASC`,
      )
      .all(...(row.parent_id ? [row.project_id, row.parent_id, row.position] : [row.project_id, row.position])) as Array<{
      id: string;
      position: number;
    }>;
    const stmt = db.prepare('UPDATE work_breakdown_items SET position = ?, updated_at = ? WHERE id = ?');
    const now = nowIso();
    for (const s of siblings) {
      stmt.run(s.position - 1, now, s.id);
    }
    return res.json({ message: '工作项删除成功', project_id: row.project_id });
  } catch (error) {
    console.error('删除工作项失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- share ----
function toShare(row: Record<string, unknown>) {
  const { password_hash, ...rest } = row;
  void password_hash;
  return {
    ...mapBooleans({ ...rest }, ['is_active']),
    has_password: !!row.password_hash,
  };
}

function toShareById(row: Record<string, unknown>) {
  return {
    ...mapBooleans({ ...row, password_hash: undefined }, ['is_active']),
    has_password: !!row.password_hash,
  };
}

function projectsOf(shareId: string) {
  return getDb()
    .prepare(
      `SELECT p.id, p.name, p.code FROM work_breakdown_share_projects sp
       JOIN projects p ON p.id = sp.project_id WHERE sp.share_id = ?`,
    )
    .all(shareId) as Array<{ id: string; name: string; code: string }>;
}

function deleteExpiredOf(userId: string) {
  getDb()
    .prepare('DELETE FROM work_breakdown_shares WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at < ?')
    .run(userId, nowIso());
}

function ownedShare(id: string, userId: string) {
  return getDb()
    .prepare('SELECT * FROM work_breakdown_shares WHERE id = ? AND user_id = ?')
    .get(id, userId) as Record<string, unknown> | undefined;
}

wbShareRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const body = req.body as {
      project_ids?: string[];
      password?: string;
      expires_at?: string | null;
    };
    const projectIds = Array.from(new Set(body.project_ids || []));
    if (projectIds.length === 0) {
      return res.status(400).json({ error: '请选择要分享的项目' });
    }

    const db = getDb();
    const placeholders = projectIds.map(() => '?').join(',');
    const owned = db
      .prepare(`SELECT id, name, code FROM projects WHERE user_id = ? AND id IN (${placeholders})`)
      .all(checked.user.id, ...projectIds) as Array<{ id: string; name: string; code: string }>;
    if (owned.length !== projectIds.length) {
      return res.status(403).json({ error: '包含不属于你的项目' });
    }

    if (body.expires_at && isNaN(new Date(body.expires_at).getTime())) {
      return res.status(400).json({ error: '过期时间格式不正确' });
    }

    const now = nowIso();
    const id = newId();
    const token = generateShareToken();
    const passwordHash = body.password ? await hashPassword(body.password) : null;

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO work_breakdown_shares (id, project_id, user_id, share_token, password_hash, expires_at, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(id, projectIds[0], checked.user.id, token, passwordHash, body.expires_at || null, now, now);
      const stmt = db.prepare(
        'INSERT INTO work_breakdown_share_projects (id, share_id, project_id, created_at) VALUES (?, ?, ?, ?)',
      );
      for (const pid of projectIds) {
        stmt.run(newId(), id, pid, now);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const share = db.prepare('SELECT * FROM work_breakdown_shares WHERE id = ?').get(id) as Record<string, unknown>;
    return res.status(201).json({ share: { ...toShare(share), projects: owned }, message: '分享创建成功' });
  } catch (error) {
    console.error('创建分享失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

wbShareRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    deleteExpiredOf(checked.user.id);
    const rows = getDb()
      .prepare('SELECT * FROM work_breakdown_shares WHERE user_id = ? ORDER BY created_at DESC')
      .all(checked.user.id) as Record<string, unknown>[];
    const shares = rows.map((r) => ({ ...toShare(r), projects: projectsOf(r.id as string) }));
    return res.json({ shares, total: shares.length });
  } catch (error) {
    console.error('获取分享列表失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

wbShareRouter.delete('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    deleteExpiredOf(checked.user.id);
    return res.json({ message: '清理完成' });
  } catch (error) {
    console.error('清理过期分享失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

wbShareRouter.get('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const row = ownedShare(req.params.id, checked.user.id);
    if (!row) return res.status(404).json({ error: '分享不存在' });

    if (q(req, 'get_password') === 'true') {
      return res.json({ has_password: !!row.password_hash });
    }
    return res.json({ share: { ...toShareById(row), projects: projectsOf(req.params.id) } });
  } catch (error) {
    console.error('获取分享失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

wbShareRouter.put('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const row = ownedShare(req.params.id, checked.user.id);
    if (!row) return res.status(404).json({ error: '分享不存在' });

    const body = req.body as {
      password?: string | null;
      expires_at?: string | null;
      is_active?: boolean;
    };
    const db = getDb();
    const sets: string[] = [];
    const args: unknown[] = [];

    if (body.password !== undefined) {
      sets.push('password_hash = ?');
      args.push(body.password ? await hashPassword(body.password) : null);
    }
    if (body.expires_at !== undefined) {
      if (body.expires_at && isNaN(new Date(body.expires_at).getTime())) {
        return res.status(400).json({ error: '过期时间格式不正确' });
      }
      sets.push('expires_at = ?');
      args.push(body.expires_at || null);
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      args.push(toInt(body.is_active));
    }
    sets.push('updated_at = ?');
    args.push(nowIso(), req.params.id);
    db.prepare(`UPDATE work_breakdown_shares SET ${sets.join(', ')} WHERE id = ?`).run(...args);

    const updated = db.prepare('SELECT * FROM work_breakdown_shares WHERE id = ?').get(req.params.id) as Record<
      string,
      unknown
    >;
    return res.json({
      share: { ...toShareById(updated), projects: projectsOf(req.params.id) },
      message: '分享更新成功',
    });
  } catch (error) {
    console.error('更新分享失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

wbShareRouter.delete('/:id', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const row = ownedShare(req.params.id, checked.user.id);
    if (!row) return res.status(404).json({ error: '分享不存在' });
    getDb().prepare('DELETE FROM work_breakdown_shares WHERE id = ?').run(req.params.id);
    return res.json({ message: '分享删除成功' });
  } catch (error) {
    console.error('删除分享失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});
