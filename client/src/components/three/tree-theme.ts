import type { GraphWorldVisuals } from './GraphWorld';

/**
 * 3D 图谱统一视觉主题（工作分解 3D 世界与团队报告星图共用）。
 * 以工作分解 3D 世界为基准：层级配色、节点半径、场景参数、视口高度与图例样式
 * 全部从这里取，禁止在两个页面里各写一份。
 */

export const TREE_LEVEL_COLORS = ['#2196f3', '#4caf50', '#ffc107', '#9c27b0', '#f44336', '#00bcd4'];

export const TREE_LEVEL_NAMES = ['项目', '1级', '2级', '3级', '4级', '5级+'];

/** 本期无数据 / 未激活节点的统一灰蓝色。 */
export const TREE_INACTIVE_COLOR = '#475569';

export const treeLevelColor = (level: number): string =>
  TREE_LEVEL_COLORS[Math.min(Math.max(level, 0), TREE_LEVEL_COLORS.length - 1)];

export const treeLevelName = (level: number): string =>
  TREE_LEVEL_NAMES[Math.min(Math.max(level, 0), TREE_LEVEL_NAMES.length - 1)];

/** 节点半径按层级收敛，两个页面共用同一套尺度。 */
export const treeNodeRadius = (level: number): number => {
  const sizes = [2.0, 1.3, 1.0, 0.85, 0.7, 0.6];
  return sizes[Math.min(Math.max(level, 0), sizes.length - 1)];
};

/** 3D 视口高度（与页面其它卡片留白一致）。 */
export const TREE_VIEWPORT_CLASS =
  'h-[calc(100dvh-300px)] min-h-120 w-full bg-[#050a18] sm:h-[calc(100dvh-250px)] lg:h-[calc(100dvh-225px)]';

/** 场景视觉参数：两个页面原样共用，只有相机远近由各自布局决定。 */
export const TREE_VISUALS: GraphWorldVisuals = {
  fogDensity: 0.0021,
  cameraFar: 3000,
  minDistance: 6,
  maxDistance: 520,
  rotateSpeed: 0.55,
  hemiIntensity: 0.9,
  dirIntensity: 1.25,
  dirPosition: [30, 50, 20],
  coreLightColor: '#6ab0ff',
  coreLightIntensity: 90,
  coreLightDistance: 220,
  skyRadius: 1200,
  dustCount: 700,
  dustInner: 40,
  dustOuter: 420,
  scanColors: ['#38bdf8', '#a855f7', '#22d3ee'],
  bloomStrength: 0.62,
  bloomRadius: 0.72,
  bloomThreshold: 0.68,
  edgeSegments: 8,
  maxSparks: 1600,
  introDuration: 2.0,
  glowFactor: 6.4,
  glowBoostFactor: 2.4,
  labelLift: 1.7,
  labelStyle: { fontSize: 50, padX: 76, maxLength: 12 },
  homeMinDistance: 24,
  homeDistanceFactor: 1.9,
  homeDir: [0.7, 0.5, 1],
  introStartScale: 0.4,
  introSpin: -0.85,
};

/** 连线密集的场景（团队星图）：沿用同一套风格，只把连线与流光压暗。 */
export const TREE_DENSE_VISUALS: GraphWorldVisuals = {
  ...TREE_VISUALS,
  edgeOpacity: 0.3,
  edgeIdleBrightness: 0.35,
  flowOpacity: 0.35,
};

/** 地面网格：与工作分解 3D 世界同一尺寸/透明度，y 由各页面按节点最低点计算。 */
export const treeGrid = (minY: number): { size: number; y: number; opacity: number } => ({
  size: 300,
  y: minY - 9,
  opacity: 0.4,
});

export interface TreeLegendItem {
  color: string;
  label: string;
}
