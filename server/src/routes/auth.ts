import { Router } from 'express';
import { getDb, newId, nowIso } from '../lib/database';
import { issueCaptcha, verifyCaptcha } from '../lib/captcha';
import {
  clearSessionCookie,
  comparePassword,
  createSessionCookie,
  getCurrentUser,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  setSessionCookie,
} from '../lib/session';

const router = Router();

function seedDefaultSettings(userId: string, now: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO user_ai_settings
      (id, user_id, api_url, api_key, model_name, system_prompt, user_prompt, is_enabled,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    newId(),
    userId,
    process.env.AI_API_URL || 'https://api.deepseek.com/v1',
    process.env.AI_API_KEY || null,
    process.env.AI_MODEL_NAME || 'deepseek-chat',
    process.env.AI_SYSTEM_PROMPT ||
      '你是一个智能助手，可以帮助用户生成日报、周报和月报。请根据用户提供的信息，生成专业、简洁的报告内容。',
    process.env.AI_USER_PROMPT || '请根据我的工作内容，生成一份专业的日报。',
    now,
    now,
  );
}

// 获取验证码：直接返回 4 位数字字母文本，前端展示在页面上（不区分大小写）。
router.get('/captcha', (_req, res) => {
  try {
    const captcha = issueCaptcha();
    return res.json(captcha);
  } catch (error) {
    console.error('获取验证码失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      email?: string;
      password?: string;
      captchaToken?: string;
      captcha?: string;
    };
    const name = (body.name || '').trim();
    const email = normalizeEmail(body.email || '');
    const password = body.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少为6个字符' });
    }
    if (!verifyCaptcha(body.captchaToken, body.captcha)) {
      return res.status(400).json({ error: '验证码不正确或已过期，请重试' });
    }

    const db = getDb();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) {
      return res.status(400).json({ error: '该邮箱已被注册' });
    }

    const isFirstUser = !(db.prepare('SELECT id FROM users LIMIT 1').get() as unknown);
    const now = nowIso();
    const userId = newId();
    const passwordHash = await hashPassword(password);

    db.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      email,
      passwordHash,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO user_profiles (id, email, full_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(userId, email, name || email.split('@')[0], isFirstUser ? '["admin","user"]' : '["user"]', now, now);
    seedDefaultSettings(userId, now);

    const token = await createSessionCookie({ id: userId, email });
    setSessionCookie(res, token);
    return res.json({ user: { id: userId, email }, message: '注册成功' });
  } catch (error) {
    console.error('注册失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const body = req.body as {
      email?: string;
      password?: string;
      captchaToken?: string;
      captcha?: string;
    };
    const email = normalizeEmail(body.email || '');
    const password = body.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' });
    }
    if (!verifyCaptcha(body.captchaToken, body.captcha)) {
      return res.status(400).json({ error: '验证码不正确或已过期，请重试' });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email) as
      | { id: string; email: string; password_hash: string }
      | undefined;
    if (!user || !(await comparePassword(password, user.password_hash))) {
      return res.status(401).json({ error: '邮箱或密码不正确' });
    }

    const token = await createSessionCookie({ id: user.id, email: user.email });
    setSessionCookie(res, token);
    return res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('登录失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  return res.json({ message: '已退出登录' });
});

// 当前登录用户信息 + 资料（前端 AuthProvider 初始化用；资料缺失时自动补建）。
router.get('/me', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ error: '未登录' });
    }
    const db = getDb();
    let profile = db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(user.id) as Record<
      string,
      unknown
    > | undefined;
    if (!profile) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO user_profiles (id, email, full_name, role, created_at, updated_at)
         VALUES (?, ?, ?, '["user"]', ?, ?)`,
      ).run(user.id, user.email, user.email.split('@')[0], now, now);
      profile = db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(user.id) as Record<
        string,
        unknown
      > | undefined;
    }
    if (!profile) {
      return res.status(401).json({ error: '用户资料不存在' });
    }
    try {
      profile.role = JSON.parse(profile.role as string);
    } catch {
      profile.role = ['user'];
    }
    return res.json({ user, profile: profile as unknown });
  } catch (error) {
    console.error('获取当前用户失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 本地直接重置密码（无需邮件）：凭 邮箱 + 验证码 + 新密码。
router.post('/reset-password', async (req, res) => {
  try {
    const body = req.body as {
      email?: string;
      newPassword?: string;
      captchaToken?: string;
      captcha?: string;
    };
    const email = normalizeEmail(body.email || '');
    const newPassword = body.newPassword || '';

    if (!email || !newPassword) {
      return res.status(400).json({ error: '请输入邮箱和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '密码长度至少为6个字符' });
    }
    if (!verifyCaptcha(body.captchaToken, body.captcha)) {
      return res.status(400).json({ error: '验证码不正确或已过期，请重试' });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) {
      return res.status(404).json({ error: '该邮箱尚未注册' });
    }

    const passwordHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      passwordHash,
      nowIso(),
      user.id,
    );
    return res.json({ message: '密码重置成功，请使用新密码登录' });
  } catch (error) {
    console.error('重置密码失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
