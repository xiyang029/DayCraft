import { Router } from 'express';
import { getDb } from '../lib/database';
import { requireUser } from '../lib/session';

const router = Router();

// 用户列表（登录可见）：供工作分解参与人员等需要选择真实人员的场景。
// 只返回展示必需字段，不含 role 等敏感信息；管理操作仍走 /api/admin。
router.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const users = getDb()
      .prepare('SELECT id, full_name, email FROM user_profiles ORDER BY created_at ASC')
      .all() as Array<{ id: string; full_name: string | null; email: string }>;
    return res.json({ users });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
