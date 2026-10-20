import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { hashString } from '@/lib/three/scifi-kit';
import GraphWorld, {
  type GraphWorldEdgeInput,
  type GraphWorldNodeInput,
} from '@/components/three/GraphWorld';
import { GraphDetailCard, GraphLegendCard, LevelBadge } from '@/components/three/GraphHud';
import {
  TREE_LEVEL_COLORS,
  TREE_LEVEL_NAMES,
  TREE_VIEWPORT_CLASS,
  TREE_VISUALS,
  treeGrid,
  treeLevelColor,
  treeLevelName,
  treeNodeRadius,
} from '@/components/three/tree-theme';
import { useGraphHover } from '@/components/three/use-graph-hover';
import { Badge } from '@/components/ui/badge';
import { getWorkStatusStyle } from '@/lib/utils/status-colors';
import type { WorkItem } from '../../lib/services/work-breakdown';

interface WorkBreakdown3DWorldProps {
  workItems: WorkItem[];
  projectName: string;
}

interface FlatNode {
  key: string;
  name: string;
  description?: string;
  progress_notes?: string;
  status?: string;
  tags?: string;
  members?: string;
  level: number;
  path: string;
  parentKey: string | null;
}

// 工作项树拍平（含虚拟项目根节点），保留父子关系与路径
function flattenWorkItems(workItems: WorkItem[], projectName: string): FlatNode[] {
  const flat: FlatNode[] = [];
  flat.push({
    key: '__root__',
    name: projectName,
    description: '项目根节点',
    level: 0,
    path: projectName,
    parentKey: null,
  });
  const walk = (items: WorkItem[], parentKey: string, parentPath: string, level: number) => {
    for (const item of items) {
      const path = `${parentPath} / ${item.name}`;
      flat.push({
        key: item.id,
        name: item.name,
        description: item.description,
        progress_notes: item.progress_notes,
        status: item.status,
        tags: item.tags,
        members: item.members,
        level,
        path,
        parentKey,
      });
      if (item.children.length > 0) {
        walk(item.children, item.id, path, level + 1);
      }
    }
  };
  walk(workItems, '__root__', projectName, 1);
  return flat;
}

// Fibonacci 球面均匀方向（确定性，无随机抖动）
function fibonacciDir(index: number, total: number, phase: number): THREE.Vector3 {
  if (total === 1) return new THREE.Vector3(1, 0.2, 0).normalize();
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * index + phase;
  return new THREE.Vector3(Math.cos(theta) * r, y * 0.9, Math.sin(theta) * r).normalize();
}

// 递归银河布局：子节点分布在父节点周围的球面上
function layoutPositions(flat: FlatNode[]): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  const childrenOf = new Map<string, FlatNode[]>();
  for (const node of flat) {
    if (node.parentKey) {
      const list = childrenOf.get(node.parentKey) ?? [];
      list.push(node);
      childrenOf.set(node.parentKey, list);
    }
  }
  positions.set('__root__', new THREE.Vector3(0, 0, 0));
  const place = (parentKey: string) => {
    const parentPos = positions.get(parentKey);
    const children = childrenOf.get(parentKey) ?? [];
    if (!parentPos || children.length === 0) return;
    const spread = parentKey === '__root__' ? 2.2 : 1;
    const radius = Math.max(7, 4.5 + children.length * 1.7) * spread;
    const phase = (hashString(parentKey) % 360) * (Math.PI / 180);
    children.forEach((child, i) => {
      const dir = fibonacciDir(i, children.length, phase);
      positions.set(child.key, parentPos.clone().addScaledVector(dir, radius));
      place(child.key);
    });
  };
  place('__root__');
  return positions;
}

export default function WorkBreakdown3DWorld({ workItems, projectName }: WorkBreakdown3DWorldProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { hoveredKey, onHoverKeyChange, detailHoverProps, clearHover } = useGraphHover();

  const flat = useMemo(() => flattenWorkItems(workItems, projectName), [workItems, projectName]);
  const flatByKey = useMemo(() => new Map(flat.map((n) => [n.key, n])), [flat]);

  const activeNode = selectedKey ? flatByKey.get(selectedKey) ?? null : null;
  const hoverNode = !activeNode && hoveredKey ? flatByKey.get(hoveredKey) ?? null : null;
  const detailNode = activeNode ?? hoverNode;

  // ---------- 布局：递归银河（位置/半径/颜色由层级决定，配色与团队星图共用） ----------
  const layout = useMemo(() => {
    const positions = layoutPositions(flat);
    const nodes: GraphWorldNodeInput[] = [];
    const edges: GraphWorldEdgeInput[] = [];
    for (const node of flat) {
      const base = positions.get(node.key);
      if (!base) continue;
      nodes.push({
        key: node.key,
        label: node.name,
        base,
        radius: treeNodeRadius(node.level),
        color: treeLevelColor(node.level),
      });
    }
    for (const node of flat) {
      if (!node.parentKey) continue;
      edges.push({
        a: node.parentKey,
        b: node.key,
        salt: node.key,
        color: treeLevelColor(node.level),
      });
    }
    let minY = 0;
    positions.forEach((pos) => {
      minY = Math.min(minY, pos.y);
    });
    return { nodes, edges, minY };
  }, [flat]);

  const renderBadgeList = (
    value: string | undefined,
    variant: 'secondary' | 'outline',
    keyPrefix: string,
    className?: string,
  ) => {
    if (!value) return null;
    const items = value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
    if (items.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {items.map((item, idx) => (
          <Badge variant={variant} key={`${keyPrefix}-${idx}`} className={className}>
            {item}
          </Badge>
        ))}
      </div>
    );
  };

  const detailStyle = detailNode ? getWorkStatusStyle(detailNode.status) : null;
  const closeDetail = () => {
    setSelectedKey(null);
    clearHover();
  };

  return (
    <GraphWorld
      nodes={layout.nodes}
      edges={layout.edges}
      selectedKey={selectedKey}
      hoveredKey={hoveredKey}
      onPick={setSelectedKey}
      onHoverKeyChange={onHoverKeyChange}
      dimUnrelated
      visuals={TREE_VISUALS}
      grid={treeGrid(layout.minY)}
      viewportClassName={TREE_VIEWPORT_CLASS}
      toolbarBadge={(
        <Badge variant="secondary" className="ml-1">
          共 {flat.length} 个节点
        </Badge>
      )}
      legend={(
        <GraphLegendCard
          items={TREE_LEVEL_COLORS.map((color, index) => ({ color, label: TREE_LEVEL_NAMES[index] }))}
          hint="左键拖拽旋转 · 滚轮缩放 · 右键拖拽平移 · 鼠标掠过与点击节点触发粒子"
        />
      )}
    >
      {/* 详情卡片：悬浮或点击时显示（与团队报告星图共用同一套卡片样式） */}
      {detailNode && (
        <GraphDetailCard title={detailNode.name} onClose={closeDetail} hoverProps={detailHoverProps}>
          <div className="flex flex-wrap items-center gap-1.5">
            {detailNode.status && detailStyle && (
              <Badge variant={detailStyle.badgeVariant} className={detailStyle.badgeClassName}>
                {detailNode.status}
              </Badge>
            )}
            <LevelBadge color={treeLevelColor(detailNode.level)} label={treeLevelName(detailNode.level)} />
          </div>
          <p className="text-xs break-all text-muted-foreground">{detailNode.path}</p>
          {detailNode.description && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-foreground">工作描述</h4>
              <p className="text-sm text-muted-foreground">{detailNode.description}</p>
            </div>
          )}
          {detailNode.progress_notes && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-foreground">工作进展备注</h4>
              <p className="rounded border border-border bg-muted p-2 text-sm whitespace-pre-wrap text-muted-foreground">
                {detailNode.progress_notes}
              </p>
            </div>
          )}
          {detailNode.tags && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-foreground">工作标签</h4>
              {renderBadgeList(detailNode.tags, 'secondary', '3d-tag')}
            </div>
          )}
          {detailNode.members && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-foreground">参与人员</h4>
              {renderBadgeList(
                detailNode.members,
                'outline',
                '3d-member',
                'border-primary/30 bg-accent text-primary',
              )}
            </div>
          )}
        </GraphDetailCard>
      )}
    </GraphWorld>
  );
}
