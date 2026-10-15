import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from './database';
import { signSession, verifySession } from './jwt';

export const SESSION_COOKIE = 'daycraft_session';
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export function getSessionSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.warn('[auth] 未设置 AUTH_SECRET 环境变量，使用内置开发密钥，请在生产环境务必配置');
    return 'daycraft-dev-secret-please-set-AUTH_SECRET';
  }
  return secret;
}

export type CurrentUser = { id: string; email: string };

/** 兼容 express（req.cookies，需 cookie-parser）与最小鸭子类型。 */
type CookieSource = { cookies?: Record<string, string> };

export async function createSessionCookie(user: CurrentUser): Promise<string> {
  const token = await signSession(
    { sub: user.id },
    getSessionSecret(),
    SESSION_MAX_AGE_SEC,
  );
  return token;
}

export function setSessionCookie(res: Response, token: string, maxAge = SESSION_MAX_AGE_SEC): void {
  // 仅当经 HTTPS 提供服务时才置 Secure（局域网 HTTP 部署置 Secure 会导致浏览器拒绝发送 Cookie，
  // 登录态直接失效）。不要绑定 NODE_ENV，显式用 COOKIE_SECURE 开关。
  const secure = process.env.COOKIE_SECURE === 'true';
  res.cookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: maxAge * 1000,
    secure,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** 从请求 Cookie 解析当前用户；未登录返回 null。 */
export async function getCurrentUser(req: CookieSource): Promise<CurrentUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const payload = await verifySession(token, getSessionSecret());
  if (!payload) return null;
  // 用户可能已被管理员删除：令牌签名有效但账号已不存在时视为未登录，
  // 否则后续按 user.id 写库会触发外键失败。
  const row = getDb().prepare('SELECT id, email FROM users WHERE id = ?').get(payload.sub) as
    | { id: string; email: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, email: row.email };
}

export type AuthResult = { ok: true; user: CurrentUser } | { ok: false; status: 401 | 403; error: string };

/** 要求已登录，否则返回 ok:false（调用方直接 res.status().json()）。 */
export async function requireUser(req: CookieSource): Promise<AuthResult> {
  const user = await getCurrentUser(req);
  if (!user) {
    return { ok: false, status: 401, error: '未授权访问' };
  }
  return { ok: true, user };
}

/** 查询用户是否为管理员（role JSON 数组包含 admin）。 */
export function isAdmin(userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT role FROM user_profiles WHERE id = ?').get(userId) as
    | { role: string }
    | undefined;
  if (!row) return false;
  try {
    const roles = JSON.parse(row.role) as string[];
    return Array.isArray(roles) && roles.includes('admin');
  } catch {
    return false;
  }
}

/** 要求管理员，否则返回 ok:false。 */
export async function requireAdmin(req: CookieSource): Promise<AuthResult> {
  const checked = await requireUser(req);
  if (!checked.ok) return checked;
  if (!isAdmin(checked.user.id)) {
    return { ok: false, status: 403, error: '需要管理员权限' };
  }
  return checked;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
