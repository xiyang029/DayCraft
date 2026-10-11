// 4 位数字字母验证码（不区分大小写，无需邮件）。
// 由服务端签发、服务端一次性核销；前端直接以文本形式展示 code。
// 注意：持久化在 SQLite 而非内存——Next.js 各路由可能被独立打包，
// 模块级内存 Map 无法跨路由共享，会导致签发后核销失败。

import { getDb } from './database';

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I
const CODE_LEN = 4;
const TTL_MS = 5 * 60 * 1000;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) code += CHARSET[bytes[i] % CHARSET.length];
  return code;
}

export function issueCaptcha(): { token: string; code: string; expiresIn: number } {
  const db = getDb();
  const now = Date.now();
  // 机会式清理过期验证码
  if (Math.random() < 0.05) {
    db.prepare('DELETE FROM captchas WHERE expires_at <= ?').run(now);
  }
  const token = randomToken();
  const code = randomCode();
  db.prepare('INSERT INTO captchas (token, code, expires_at) VALUES (?, ?, ?)').run(
    token,
    code,
    now + TTL_MS,
  );
  return { token, code, expiresIn: Math.floor(TTL_MS / 1000) };
}

/** 校验成功返回 true（一次性核销）；失败返回 false。大小写不敏感。 */
export function verifyCaptcha(token: string | undefined | null, input: string | undefined | null): boolean {
  if (!token || !input) return false;
  const db = getDb();
  const record = db.prepare('SELECT code, expires_at FROM captchas WHERE token = ?').get(token) as
    | { code: string; expires_at: number }
    | undefined;
  if (!record) return false;
  db.prepare('DELETE FROM captchas WHERE token = ?').run(token);
  if (record.expires_at <= Date.now()) return false;
  return record.code.toLowerCase() === String(input).trim().toLowerCase();
}
