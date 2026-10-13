import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema';

let db: DatabaseSync | null = null;

export function getDbPath(): string {
  if (process.env.SQLITE_DB_PATH) return process.env.SQLITE_DB_PATH;
  // 默认指向仓库根目录 data/daycraft.db（与旧 Next.js 版一致，便于平滑迁移）。
  // 本文件位于 server/src/lib（或 server/dist/lib），向上三级即仓库根。
  return path.join(__dirname, '..', '..', '..', 'data', 'daycraft.db');
}

/** 获取全局单例 SQLite 连接（node:sqlite 内置模块），首次调用时建库建表。 */
export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA_SQL);
  // 历史迁移：钉钉集成已下线，删除遗留表（新库无此表，DROP 幂等无害）
  db.exec('DROP TABLE IF EXISTS user_dingtalk_settings;');
  // 历史迁移：AI 调用次数限额已下线，删除遗留列（新库无此列，老库幂等清理）
  // 历史迁移：系统内置 AI 已下线，只保留用户自定义，删除 settings_type 列
  for (const col of [
    'system_ai_remaining_calls',
    'system_ai_total_calls_limit',
    'system_ai_calls',
    'custom_ai_calls',
    'settings_type',
  ]) {
    try {
      const cols = db
        .prepare(`PRAGMA table_info(user_ai_settings)`)
        .all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE user_ai_settings DROP COLUMN ${col};`);
      }
    } catch {
      // 老版本 SQLite 不支持 DROP COLUMN 时忽略，列残留但业务不再读写
    }
  }
  return db;
}

/** 仅测试 / 脚本使用：关闭并重置单例。 */
export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 行对象里的 0/1 转 boolean（就地转换指定字段）。 */
export function mapBooleans<T extends Record<string, unknown>>(row: T, fields: string[]): T {
  for (const f of fields) {
    if (row[f] === 0 || row[f] === 1) {
      (row as Record<string, unknown>)[f] = row[f] === 1;
    }
  }
  return row;
}

export function toInt(v: boolean | number | undefined | null, fallback = 0): number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v ? 1 : 0;
  return fallback;
}
