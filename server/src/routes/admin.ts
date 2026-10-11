import { Router } from 'express';
import { getDb, nowIso } from '../lib/database';
import { requireAdmin } from '../lib/session';

const router = Router();

// 管理员总览：用户列表 + 各维度计数 + 最近日报回填。
router.get('/overview', async (req, res) => {
  try {
    const checked = await requireAdmin(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const db = getDb();
    const profiles = db
      .prepare(
        'SELECT id, full_name, email, role, created_at, updated_at, last_report_edit_at FROM user_profiles ORDER BY created_at DESC',
      )
      .all() as Array<Record<string, unknown>>;

    const projectCounts = db
      .prepare('SELECT user_id, COUNT(*) AS cnt FROM projects GROUP BY user_id')
      .all() as Array<{ user_id: string; cnt: number }>;
    const reportCounts = db
      .prepare('SELECT user_id, COUNT(*) AS cnt FROM daily_reports GROUP BY user_id')
      .all() as Array<{ user_id: string; cnt: number }>;
    const recentReports = db
      .prepare('SELECT id, user_id, updated_at FROM daily_reports ORDER BY updated_at DESC LIMIT 50')
      .all() as Array<{ id: string; user_id: string; updated_at: string }>;

    const toMap = (rows: Array<{ user_id: string; cnt: number }>) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[r.user_id] = Number(r.cnt);
      return m;
    };

    return res.json({
      users: profiles.map((p) => {
        let role: string[] = ['user'];
        try {
          role = JSON.parse(p.role as string);
        } catch {
          // keep default
        }
        return { ...p, role };
      }),
      projectCounts: toMap(projectCounts),
      reportCounts: toMap(reportCounts),
      recentReports,
    });
  } catch (error) {
    console.error('获取管理员总览失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 管理员更新用户角色：{role: ['user'] | ['admin','user'] ...}
router.put('/users/:id', async (req, res) => {
  try {
    const checked = await requireAdmin(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const id = req.params.id;
    if (id === user.id) {
      return res.status(400).json({ error: '不能修改自己的角色' });
    }
    const body = req.body as { role?: string[] };
    if (!Array.isArray(body.role) || body.role.length === 0) {
      return res.status(400).json({ error: '角色不正确' });
    }
    const allowed = ['user', 'admin'];
    if (!body.role.every((r) => allowed.includes(r))) {
      return res.status(400).json({ error: '角色不正确' });
    }
    const db = getDb();
    const exists = db.prepare('SELECT id FROM user_profiles WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ error: '用户不存在' });
    db.prepare('UPDATE user_profiles SET role = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(body.role),
      nowIso(),
      id,
    );
    return res.json({ message: '角色更新成功' });
  } catch (error) {
    console.error('更新用户角色失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 管理员删除用户：其项目/日报/待办/分解/分享等通过外键级联清理，不允许删除自己
router.delete('/users/:id', async (req, res) => {
  try {
    const checked = await requireAdmin(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const id = req.params.id;
    if (id === checked.user.id) {
      return res.status(400).json({ error: '不能删除自己' });
    }
    const db = getDb();
    const target = db.prepare('SELECT id, email FROM user_profiles WHERE id = ?').get(id) as
      | { id: string; email: string }
      | undefined;
    if (!target) return res.status(404).json({ error: '用户不存在' });
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return res.json({ message: `用户 ${target.email} 已删除，其全部数据已级联清理` });
  } catch (error) {
    console.error('删除用户失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
