import { Router } from 'express';
import { getDb } from '../lib/database';
import { comparePassword } from '../lib/session';
import { isShareValid, isValidShareToken } from '../lib/share';
import { toWorkItem } from '../lib/work-items';

const router = Router();

function q(req: { query: unknown }, n: string): string | undefined {
  const query = req.query as Record<string, unknown>;
  const v = query[n];
  return Array.isArray(v) ? String(v[0]) : (v as string | undefined);
}

function findShare(token: string) {
  return getDb().prepare('SELECT * FROM work_breakdown_shares WHERE share_token = ?').get(token) as
    | Record<string, unknown>
    | undefined;
}

router.get('/:token', async (req, res) => {
  try {
    const token = req.params.token;
    if (!token || !isValidShareToken(token)) {
      return res.status(404).json({ error: '分享链接无效' });
    }

    const db = getDb();
    const share = findShare(token);
    if (!share || !isShareValid({ is_active: (share.is_active as number) === 1, expires_at: share.expires_at as string | null })) {
      return res.status(404).json({ error: '分享链接无效或已过期' });
    }

    if (share.password_hash) {
      const password = q(req, 'password') || '';
      if (!password) {
        return res.status(401).json({ error: '该分享需要访问密码', need_password: true });
      }
      if (!(await comparePassword(password, share.password_hash as string))) {
        return res.status(403).json({ error: '访问密码不正确', need_password: true });
      }
    }

    const projects = db
      .prepare(
        `SELECT p.id, p.name, p.code, p.description FROM work_breakdown_share_projects sp
         JOIN projects p ON p.id = sp.project_id WHERE sp.share_id = ?`,
      )
      .all(share.id) as Array<{ id: string; name: string; code: string; description: string | null }>;
    if (projects.length === 0) {
      return res.status(404).json({ error: '分享内容为空' });
    }

    const requestedProjectId = q(req, 'project_id');
    const currentProject = projects.find((p) => p.id === requestedProjectId) || projects[0];

    const rows = db
      .prepare('SELECT * FROM work_breakdown_items WHERE project_id = ? AND user_id = ? ORDER BY position ASC')
      .all(currentProject.id, share.user_id) as Record<string, unknown>[];
    const flat = rows.map(toWorkItem);

    // 扁平转树（与 WorkBreakdownService.buildWorkItemsTree 一致）
    const itemMap: Record<string, Record<string, unknown>> = {};
    const roots: Record<string, unknown>[] = [];
    for (const item of flat) {
      itemMap[item.id] = {
        id: `db-${item.id}`,
        dbId: item.id,
        name: item.name,
        description: item.description || '',
        children: [],
        isExpanded: item.is_expanded,
        level: item.level,
        position: item.position,
        status: item.status,
        tags: item.tags || '',
        members: item.members || '',
        progress_notes: item.progress_notes || '',
        planned_start_time: item.planned_start_time || undefined,
        planned_end_time: item.planned_end_time || undefined,
        actual_start_time: item.actual_start_time || undefined,
        actual_end_time: item.actual_end_time || undefined,
        is_milestone: item.is_milestone || false,
      };
    }
    for (const item of flat) {
      const node = itemMap[item.id];
      if (item.parent_id && itemMap[item.parent_id]) {
        (itemMap[item.parent_id].children as unknown[]).push(node);
      } else {
        roots.push(node);
      }
    }
    const sortChildren = (nodes: Record<string, unknown>[]) => {
      nodes.sort((a, b) => (a.position as number) - (b.position as number));
      for (const n of nodes) sortChildren(n.children as Record<string, unknown>[]);
    };
    sortChildren(roots);

    const owner = db.prepare('SELECT full_name, email FROM user_profiles WHERE id = ?').get(share.user_id) as
      | { full_name: string | null; email: string }
      | undefined;

    return res.json({
      project: currentProject,
      available_projects: projects,
      work_items: roots,
      share_info: {
        has_password: !!share.password_hash,
        expires_at: share.expires_at || null,
        shared_by: owner?.full_name || owner?.email || '未知用户',
        created_at: share.created_at,
        project_count: projects.length,
        current_project_id: currentProject.id,
      },
    });
  } catch (error) {
    console.error('获取公开分享失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/:token', async (req, res) => {
  try {
    const token = req.params.token;
    if (!token || !isValidShareToken(token)) {
      return res.status(404).json({ error: '分享链接无效' });
    }
    const share = findShare(token);
    if (!share || !isShareValid({ is_active: (share.is_active as number) === 1, expires_at: share.expires_at as string | null })) {
      return res.status(404).json({ error: '分享链接无效或已过期' });
    }
    if (share.password_hash) {
      const body = req.body as { password?: string };
      if (!(await comparePassword(body.password || '', share.password_hash as string))) {
        return res.status(403).json({ error: '访问密码不正确' });
      }
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('校验分享密码失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
