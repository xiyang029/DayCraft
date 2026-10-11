import type { WorkBreakdownItem } from '../db/types';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { XMindConverter } from './xmind-converter';
import { ExcelConverter } from './excel-converter';
import { saveAs } from 'file-saver';

// 前端工作项类型
export interface WorkItem {
  id: string;
  name: string;
  description: string;
  children: WorkItem[];
  isExpanded?: boolean;
  isEditing?: boolean;
  shouldDelete?: boolean;
  dbId?: string;
  level: number;
  position: number;
  status?: string;
  tags?: string;
  members?: string;
  progress_notes?: string;
  planned_start_time?: string;
  planned_end_time?: string;
  actual_start_time?: string;
  actual_end_time?: string;
  is_milestone?: boolean;
}

// 缓存接口（按项目缓存，登录用户隐含在会话中）
interface Cache {
  [key: string]: {
    data: WorkItem[];
    timestamp: number;
  };
}

export class WorkBreakdownService {
  private cache: Cache = {};
  private cacheDuration = 60000; // 缓存有效期1分钟
  private xmindConverter = new XMindConverter();
  private excelConverter = new ExcelConverter();

  // 拉取扁平列表（无缓存，供移动/校验等逻辑使用）
  private async getFlatItems(projectId: string): Promise<WorkBreakdownItem[]> {
    const data = await apiGet<{ items: WorkBreakdownItem[] }>(
      `/api/work-breakdown/items?project_id=${encodeURIComponent(String(projectId))}`,
    );
    return data.items;
  }

  // 获取项目的工作分解项
  async getWorkBreakdownItems(projectId: any, userId: any): Promise<WorkItem[]> {
    if (!projectId) {
      return [];
    }

    const cacheKey = String(projectId);
    const now = Date.now();

    // 检查缓存
    if (this.cache[cacheKey] && now - this.cache[cacheKey].timestamp < this.cacheDuration) {
      console.log('从缓存获取工作分解数据');
      return this.cache[cacheKey].data;
    }

    console.log('从服务器获取工作分解数据');
    const items = await this.getFlatItems(String(projectId));

    // 将扁平数据转换为树形结构
    const treeItems = this.buildWorkItemsTree(items);

    // 更新缓存
    this.cache[cacheKey] = {
      data: treeItems,
      timestamp: now,
    };

    return treeItems;
  }

  // 添加工作项
  async addWorkItem(
    projectId: string,
    userId: string,
    name: string,
    description: string,
    parentId: string | null,
    level: number,
    position: number,
    status: string = '未开始',
    tags: string = '',
    members: string = '',
    progress_notes: string = '',
    planned_start_time: string = '',
    planned_end_time: string = '',
    actual_start_time: string = '',
    actual_end_time: string = '',
    is_milestone: boolean = false,
  ): Promise<{ id: string }> {
    const data = await apiPost<{ id: string }>('/api/work-breakdown/items', {
      project_id: projectId,
      name,
      description,
      parent_id: parentId,
      level,
      position,
      is_expanded: true,
      status,
      tags,
      members,
      progress_notes,
      planned_start_time: planned_start_time || null,
      planned_end_time: planned_end_time || null,
      actual_start_time: actual_start_time || null,
      actual_end_time: actual_end_time || null,
      is_milestone,
    });

    // 清除相关缓存
    this.invalidateCache(projectId);

    return { id: data.id };
  }

  // 更新工作项
  async updateWorkItem(id: string, updates: Partial<WorkBreakdownItem>): Promise<void> {
    const data = await apiPut<{ item: WorkBreakdownItem }>(
      `/api/work-breakdown/items/${encodeURIComponent(id)}`,
      updates,
    );
    // 清除相关缓存
    this.invalidateCache(data.item.project_id);
  }

  // 批量更新工作项位置
  async updateWorkItemPositions(updates: Array<{ id: string; position: number }>): Promise<void> {
    if (updates.length === 0) return;
    await apiPut('/api/work-breakdown/items', { updates });
    // 位置更新后调用方一般紧接着整体刷新，这里清除全部缓存
    this.cache = {};
  }

  // 移动工作项到新的父级或层级
  async moveWorkItem(itemId: string, newParentId: string | null, targetPosition?: number): Promise<void> {
    // 1. 获取要移动的工作项信息
    let item: WorkBreakdownItem;
    try {
      const data = await apiGet<{ item: WorkBreakdownItem }>(
        `/api/work-breakdown/items/${encodeURIComponent(itemId)}`,
      );
      item = data.item;
    } catch {
      throw new Error('工作项不存在');
    }

    if (!item.project_id) {
      throw new Error('工作项数据异常：缺少项目ID');
    }
    const flat = await this.getFlatItems(item.project_id);
    const byId = new Map(flat.map((i) => [i.id, i]));

    // 2. 验证移动的合法性（不能移入自身子项）
    if (newParentId) {
      let cursor: string | null = newParentId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        if (cursor === itemId) throw new Error('不能将工作项移动到自己的子项下');
        seen.add(cursor);
        cursor = byId.get(cursor)?.parent_id || null;
      }
    }

    // 3. 计算新的层级
    let newLevel = 0;
    if (newParentId) {
      const parent = byId.get(newParentId);
      if (!parent) throw new Error('目标父级工作项不存在');
      newLevel = parent.level + 1;
    }

    // 4. 检查层级限制（最多5级：0-4）
    const levelDiff = newLevel - item.level;
    let maxDepth = newLevel;
    const stack = [itemId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const currentLevel = current === itemId ? newLevel : (byId.get(current)?.level ?? 0) + levelDiff;
      maxDepth = Math.max(maxDepth, currentLevel);
      for (const child of flat) {
        if (child.parent_id === current) stack.push(child.id);
      }
    }
    if (maxDepth > 4) {
      throw new Error('移动后的层级深度超过限制（最多5级）');
    }

    // 5. 计算目标位置
    let finalPosition: number;
    if (targetPosition !== undefined) {
      finalPosition = targetPosition;
    } else {
      const siblings = flat.filter((i) => i.id !== itemId && (i.parent_id || null) === (newParentId || null));
      finalPosition = siblings.length > 0 ? Math.max(...siblings.map((s) => s.position)) + 1 : 0;
    }

    const oldParentId = item.parent_id || null;
    const oldPosition = item.position;

    // 6. 更新被移动的工作项
    await apiPut(`/api/work-breakdown/items/${encodeURIComponent(itemId)}`, {
      parent_id: newParentId,
      level: newLevel,
      position: finalPosition,
    });

    // 7. 递归更新所有子项的层级
    const updateChildrenLevels = async (parentId: string, parentLevel: number): Promise<void> => {
      const children = flat.filter((i) => i.parent_id === parentId);
      for (const child of children) {
        const childNewLevel = parentLevel + 1;
        await apiPut(`/api/work-breakdown/items/${encodeURIComponent(child.id)}`, { level: childNewLevel });
        child.level = childNewLevel;
        await updateChildrenLevels(child.id, childNewLevel);
      }
    };
    await updateChildrenLevels(itemId, newLevel);

    // 8. 重新整理目标位置的兄弟项位置（插入点之后后移）
    const newSiblings = (await this.getFlatItems(item.project_id)).filter(
      (i) => i.id !== itemId && (i.parent_id || null) === (newParentId || null) && i.position >= finalPosition,
    );
    if (newSiblings.length > 0) {
      await apiPut('/api/work-breakdown/items', {
        updates: newSiblings.map((s) => ({ id: s.id, position: s.position + 1 })),
      });
    }

    // 9. 重新整理原位置的兄弟项位置（移除点之后前移）
    if (oldParentId !== (newParentId || null)) {
      const oldSiblings = (await this.getFlatItems(item.project_id)).filter(
        (i) => (i.parent_id || null) === oldParentId && i.position > oldPosition,
      );
      if (oldSiblings.length > 0) {
        await apiPut('/api/work-breakdown/items', {
          updates: oldSiblings.map((s) => ({ id: s.id, position: s.position - 1 })),
        });
      }
    }

    // 10. 清除缓存
    this.invalidateCache(item.project_id);
  }

  // 获取可作为父级的工作项列表（用于移动对话框）
  async getPotentialParents(
    projectId: string,
    userId: string,
    excludeItemId: string,
  ): Promise<Array<{ id: string; name: string; level: number; path: string }>> {
    // 获取完整的工作项树结构
    const workItemsTree = await this.getWorkBreakdownItems(projectId, userId);
    const flat = await this.getFlatItems(projectId);
    const byId = new Map(flat.map((i) => [i.id, i]));

    const isDescendant = (candidateId: string): boolean => {
      let cursor: string | null | undefined = byId.get(candidateId)?.parent_id;
      while (cursor) {
        if (cursor === excludeItemId) return true;
        cursor = byId.get(cursor)?.parent_id;
      }
      return false;
    };

    // 将树形结构扁平化为按显示顺序排列的列表
    const flattenItems = (items: WorkItem[], result: any[] = []): any[] => {
      for (const item of items) {
        // 排除要移动的项目本身
        if (item.dbId !== excludeItemId) {
          result.push({
            id: item.dbId,
            name: item.name,
            level: item.level,
          });
        }
        // 递归处理子项
        if (item.children && item.children.length > 0) {
          flattenItems(item.children, result);
        }
      }
      return result;
    };

    const allItems = flattenItems(workItemsTree);

    // 过滤掉不能作为父级的项（子项和层级过深的项）
    const validParents: Array<{ id: string; name: string; level: number; path: string }> = [];
    for (const item of allItems) {
      if (!item.id) continue;
      // 检查层级限制（父级最多为3级，这样子项最多为4级）
      if (!isDescendant(item.id) && item.level < 4) {
        const path = this.buildItemPathFromTree(item.id, workItemsTree);
        validParents.push({
          id: item.id,
          name: item.name,
          level: item.level,
          path,
        });
      }
    }

    return validParents;
  }

  // 从树形结构构建工作项路径
  private buildItemPathFromTree(itemId: string, items: WorkItem[], parentPath: string = ''): string {
    for (const item of items) {
      const currentPath = parentPath ? `${parentPath} > ${item.name}` : item.name;

      if (item.dbId === itemId) {
        return currentPath;
      }

      if (item.children && item.children.length > 0) {
        const childPath = this.buildItemPathFromTree(itemId, item.children, currentPath);
        if (childPath) {
          return childPath;
        }
      }
    }
    return '';
  }

  // 删除工作项
  async deleteWorkItem(id: string): Promise<void> {
    const data = await apiDelete<{ project_id: string }>(
      `/api/work-breakdown/items/${encodeURIComponent(id)}`,
    );
    // 清除相关缓存
    if (data?.project_id) {
      this.invalidateCache(data.project_id);
    } else {
      this.cache = {};
    }
  }

  // 导出为XMind文件
  async exportToXMind(workItems: WorkItem[], projectName: string): Promise<void> {
    try {
      const blob = await this.xmindConverter.exportToXMind(workItems, projectName);
      // 使用file-saver保存文件
      saveAs(blob, `${projectName || '工作分解'}.xmind`);
      return Promise.resolve();
    } catch (error) {
      console.error('导出XMind文件失败', error);
      throw new Error('导出XMind文件失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  // 导出为Excel文件
  exportToExcel(workItems: WorkItem[], projectName: string): void {
    try {
      const blob = this.excelConverter.exportToExcel(workItems, projectName);
      // 使用file-saver保存文件
      saveAs(blob, `${projectName || '工作分解'}.xlsx`);
    } catch (error) {
      console.error('导出Excel文件失败', error);
      throw new Error('导出Excel文件失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  // 导出为Excel层级合并版文件
  exportToExcelHierarchy(workItems: WorkItem[], projectName: string): void {
    try {
      const blob = this.excelConverter.exportToExcelHierarchy(workItems, projectName);
      // 使用file-saver保存文件
      saveAs(blob, `${projectName || '工作分解'}_层级合并版.xlsx`);
    } catch (error) {
      console.error('导出Excel层级合并版文件失败', error);
      throw new Error('导出Excel层级合并版文件失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  // 下载Excel导入模板
  downloadExcelTemplate(): void {
    try {
      const blob = this.excelConverter.createImportTemplate();
      // 使用file-saver保存文件
      saveAs(blob, '工作分解导入模板.xlsx');
    } catch (error) {
      console.error('下载Excel模板失败', error);
      throw new Error('下载Excel模板失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  // 从XMind文件导入
  async importFromXMind(file: File, projectId: string, userId: string): Promise<WorkItem[]> {
    try {
      // 解析XMind文件
      const importedItems = await this.xmindConverter.importFromXMind(file);

      // 保存到数据库
      await this.saveImportedItems(importedItems, projectId, userId);

      // 清除缓存
      this.invalidateCache(projectId);

      // 重新获取工作分解项
      return this.getWorkBreakdownItems(projectId, userId);
    } catch (error) {
      console.error('导入XMind文件失败', error);
      throw new Error('导入XMind文件失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  // 从Excel文件导入
  async importFromExcel(
    file: File,
    projectId: string,
    userId: string,
    progressCallback?: (progress: number) => void,
  ): Promise<WorkItem[]> {
    try {
      // 解析Excel文件
      const importedItems = await this.excelConverter.importFromExcel(file, progressCallback);

      // 更新进度 - 开始保存到数据库
      progressCallback?.(80);

      // 保存到数据库
      await this.saveImportedItems(importedItems, projectId, userId);

      // 更新进度 - 数据库保存完成
      progressCallback?.(90);

      // 清除缓存
      this.invalidateCache(projectId);

      // 更新进度 - 完成
      progressCallback?.(100);

      // 重新获取工作分解项
      return this.getWorkBreakdownItems(projectId, userId);
    } catch (error) {
      console.error('导入Excel文件失败', error);
      throw new Error('导入Excel文件失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  // 保存导入的工作项
  private async saveImportedItems(
    items: WorkItem[],
    projectId: string,
    userId: string,
    parentId: string | null = null,
  ): Promise<void> {
    // 按顺序保存工作项
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // 添加工作项
      const result = await this.addWorkItem(
        projectId,
        userId,
        item.name,
        item.description,
        parentId,
        item.level,
        i,
        item.status || '未开始',
        item.tags || '',
        item.members || '',
        item.progress_notes || '',
        item.planned_start_time || '',
        item.planned_end_time || '',
        item.actual_start_time || '',
        item.actual_end_time || '',
        item.is_milestone || false,
      );

      // 递归保存子项
      if (item.children && item.children.length > 0) {
        await this.saveImportedItems(item.children, projectId, userId, result.id);
      }
    }
  }

  // 清除缓存
  private invalidateCache(projectId: string): void {
    const cacheKey = String(projectId);
    if (this.cache[cacheKey]) {
      delete this.cache[cacheKey];
      console.log(`清除缓存: ${cacheKey}`);
    }
  }

  // 将扁平数据转换为树形结构
  private buildWorkItemsTree(items: WorkBreakdownItem[]): WorkItem[] {
    const itemMap: Record<string, WorkItem> = {};
    const rootItems: WorkItem[] = [];

    // 首先创建所有工作项对象
    items.forEach((item) => {
      itemMap[item.id] = {
        id: `db-${item.id}`, // 添加前缀，区分前端生成的临时ID
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
    });

    // 然后构建树形结构
    items.forEach((item) => {
      const workItem = itemMap[item.id];

      if (item.parent_id && itemMap[item.parent_id]) {
        // 如果有父级，添加到父级的children中
        itemMap[item.parent_id].children.push(workItem);
      } else {
        // 否则作为根节点
        rootItems.push(workItem);
      }
    });

    // 对每个级别的子项按position排序
    const sortChildren = (items: WorkItem[]) => {
      items.sort((a, b) => a.position - b.position);
      items.forEach((item) => {
        if (item.children.length > 0) {
          sortChildren(item.children);
        }
      });
    };

    sortChildren(rootItems);

    return rootItems;
  }
}

// 导出服务实例
export const workBreakdownService = new WorkBreakdownService();
