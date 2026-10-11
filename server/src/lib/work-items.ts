import { getDb, mapBooleans } from './database';
import type { WorkBreakdownItem } from './types';

export function toWorkItem(row: Record<string, unknown>): WorkBreakdownItem {
  return mapBooleans({ ...row }, ['is_expanded', 'is_milestone']) as unknown as WorkBreakdownItem;
}

export function ownProject(projectId: string, userId: string): boolean {
  const row = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId);
  return !!row;
}

/** 工作项归属校验：工作项 -> 项目 -> 当前用户。返回工作项行或 null。 */
export function ownItem(id: string, userId: string): Record<string, unknown> | null {
  const row = getDb()
    .prepare(
      `SELECT wi.* FROM work_breakdown_items wi
       JOIN projects p ON p.id = wi.project_id
       WHERE wi.id = ? AND p.user_id = ?`,
    )
    .get(id, userId) as Record<string, unknown> | undefined;
  return row || null;
}
