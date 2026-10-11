import { getDb, nowIso } from './database';

/** 日报写入后更新用户最近编辑时间（替代原 Postgres 触发器）。 */
export function touchReportEdit(userId: string) {
  const now = nowIso();
  getDb()
    .prepare('UPDATE user_profiles SET last_report_edit_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, userId);
}
