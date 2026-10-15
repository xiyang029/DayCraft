// 工作状态对应的进度值
export const STATUS_PROGRESS_MAP = {
  '未开始': 0,
  '已暂停': 25,
  '进行中': 50,
  '已完成': 100,
} as const;

type WorkStatus = keyof typeof STATUS_PROGRESS_MAP;

// 工作项接口（简化版，用于进度计算）
interface ProgressWorkItem {
  id: string;
  status?: string;
  children?: ProgressWorkItem[];
}

/**
 * 获取工作状态对应的进度值
 * @param status 工作状态
 * @returns 进度值 (0-100)
 */
function getStatusProgress(status?: string): number {
  if (!status || !(status in STATUS_PROGRESS_MAP)) {
    return 0; // 默认未开始
  }
  return STATUS_PROGRESS_MAP[status as WorkStatus];
}

/**
 * 计算工作项的总体进度
 * 规则：工作项的进度等于下级工作进展的加权平均值与当前工作项工作状态对应取值的大值
 * @param workItem 工作项
 * @returns 进度值 (0-100)
 */
export function calculateWorkItemProgress(workItem: ProgressWorkItem): number {
  // 获取当前工作项状态对应的进度值
  const statusProgress = getStatusProgress(workItem.status);
  
  // 如果没有子项，直接返回状态对应的进度
  if (!workItem.children || workItem.children.length === 0) {
    return statusProgress;
  }
  
  // 计算子项的加权平均进度
  let totalProgress = 0;
  let totalWeight = workItem.children.length;
  
  for (const child of workItem.children) {
    const childProgress = calculateWorkItemProgress(child);
    totalProgress += childProgress;
  }
  
  const averageChildProgress = totalWeight > 0 ? totalProgress / totalWeight : 0;
  
  // 返回子项平均进度与当前状态进度的最大值
  return Math.max(statusProgress, averageChildProgress);
}

/**
 * 获取进度对应的语义化颜色类名
 * 只使用主题 token（muted / warning / primary / success），禁止硬编码调色板类名。
 * @param progress 进度值 (0-100)
 */
export function getProgressColorClass(progress: number): string {
  if (progress <= 0) {
    return 'border-border bg-muted text-muted-foreground';
  } else if (progress < 50) {
    return 'border-warning/30 bg-warning/10 text-warning';
  } else if (progress < 100) {
    return 'border-primary/30 bg-primary/10 text-primary';
  } else {
    return 'border-success/30 bg-success/10 text-success';
  }
}

/**
 * 格式化进度显示文本
 * @param progress 进度值 (0-100)
 * @returns 格式化的进度文本
 */
export function formatProgressText(progress: number): string {
  return `${Math.round(progress)}%`;
}
