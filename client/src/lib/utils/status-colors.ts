import { STATUS_PROGRESS_MAP } from './progress-calculator';

/**
 * 工作状态展示样式的唯一来源。
 * 只允许使用语义化主题 token（primary / muted / warning / success / border ...），
 * 禁止出现 bg-gray-200、text-blue-700 这类硬编码调色板类名。
 */

type WorkStatus = keyof typeof STATUS_PROGRESS_MAP;

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'ghost'
  | 'link';

interface WorkStatusStyle {
  /** 状态值，同时作为 Select 的 value */
  value: WorkStatus;
  /** Badge 组件的 variant */
  badgeVariant: BadgeVariant;
  /** Badge 的补充语义类（可为空字符串） */
  badgeClassName: string;
  /** 状态色块（统计条、圆点等） */
  solidClassName: string;
}

const WORK_STATUS_ORDER: WorkStatus[] = ['未开始', '已暂停', '进行中', '已完成'];

const WORK_STATUS_STYLES: Record<WorkStatus, WorkStatusStyle> = {
  未开始: {
    value: '未开始',
    badgeVariant: 'secondary',
    badgeClassName: '',
    solidClassName: 'bg-muted-foreground/40',
  },
  已暂停: {
    value: '已暂停',
    badgeVariant: 'outline',
    badgeClassName: 'border-warning/30 bg-warning/10 text-warning',
    solidClassName: 'bg-warning',
  },
  进行中: {
    value: '进行中',
    badgeVariant: 'outline',
    badgeClassName: 'border-primary/30 bg-primary/10 text-primary',
    solidClassName: 'bg-primary',
  },
  已完成: {
    value: '已完成',
    badgeVariant: 'outline',
    badgeClassName: 'border-success/30 bg-success/10 text-success',
    solidClassName: 'bg-success',
  },
};

/** 按固定顺序排列的状态样式，供 Select 选项 / 统计遍历使用 */
export const WORK_STATUS_OPTIONS: WorkStatusStyle[] = WORK_STATUS_ORDER.map(
  (status) => WORK_STATUS_STYLES[status]
);

/** 按状态值取样式，未知状态回退为「未开始」 */
export function getWorkStatusStyle(status?: string | null): WorkStatusStyle {
  if (status && status in WORK_STATUS_STYLES) {
    return WORK_STATUS_STYLES[status as WorkStatus];
  }
  return WORK_STATUS_STYLES['未开始'];
}
