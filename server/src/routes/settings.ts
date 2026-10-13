import { Router } from 'express';
import { getDb, mapBooleans, newId, nowIso, toInt } from '../lib/database';
import { requireUser } from '../lib/session';
import type { UserAISettings } from '../lib/types';

export const aiSettingsRouter = Router();

function toAISettings(row: Record<string, unknown>): UserAISettings {
  return mapBooleans({ ...row }, ['is_enabled']) as unknown as UserAISettings;
}

function ensureAIRow(userId: string): Record<string, unknown> {
  const db = getDb();
  let row = db.prepare('SELECT * FROM user_ai_settings WHERE user_id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    const now = nowIso();
    db.prepare('INSERT INTO user_ai_settings (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      newId(),
      userId,
      now,
      now,
    );
    row = db.prepare('SELECT * FROM user_ai_settings WHERE user_id = ?').get(userId) as Record<string, unknown>;
  }
  return row;
}

aiSettingsRouter.get('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    return res.json({ settings: toAISettings(ensureAIRow(user.id)) });
  } catch (error) {
    console.error('获取 AI 设置失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

const UPDATABLE = [
  'api_url',
  'api_key',
  'model_name',
  'system_prompt',
  'user_prompt',
  'is_enabled',
];

aiSettingsRouter.put('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const user = checked.user;
    const body = req.body as Record<string, unknown>;
    ensureAIRow(user.id);

    const sets: string[] = [];
    const args: unknown[] = [];
    for (const key of UPDATABLE) {
      if (body[key] !== undefined) {
        if (key === 'is_enabled') {
          sets.push(`${key} = ?`);
          args.push(toInt(body[key] as boolean));
        } else {
          sets.push(`${key} = ?`);
          args.push(body[key]);
        }
      }
    }
    if (sets.length === 0) {
      return res.json({ settings: toAISettings(ensureAIRow(user.id)) });
    }
    sets.push('updated_at = ?');
    args.push(nowIso(), user.id);
    getDb().prepare(`UPDATE user_ai_settings SET ${sets.join(', ')} WHERE user_id = ?`).run(...args);
    const row = getDb().prepare('SELECT * FROM user_ai_settings WHERE user_id = ?').get(user.id) as Record<
      string,
      unknown
    >;
    return res.json({ settings: toAISettings(row), message: 'AI 设置保存成功' });
  } catch (error) {
    console.error('保存 AI 设置失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});
