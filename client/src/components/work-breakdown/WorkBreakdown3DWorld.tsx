import { useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  X as XIcon,
  MousePointer2 as MousePointer2Icon,
} from 'lucide-react';
import GraphWorld, {
  type GraphWorldEdgeInput,
  type GraphWorldNodeInput,
} from '@/components/three/GraphWorld';
import { hashString } from '@/lib/three/scifi-kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getWorkStatusStyle } from '@/lib/utils/status-colors';
import type { WorkItem } from '../../lib/services/work-breakdown';

interface WorkBreakdown3DWorldProps {
  workItems: WorkItem[];
  projectName: string;
}

// 与工作导图同一套层级配色
const LEVEL_COLORS = ['#2196f3', '#4caf50', '#ffc107', '#9c27b0', '#f44336', '#00bcd4'];
const LEVEL_NAMES = ['项目', '1级', '2级', '3级', '4级', '5级+'];

const levelColor = (level: number): string => LEVEL_COLORS[Math.min(Math.max(level, 0), LEVEL_COLORS.length - 1)];

const nodeRadius = (level: number): number => {
  const sizes = [2.0, 1.3, 1.0, 0.85, 0.7, 0.6];
  return sizes[Math.min(Math.max(level, 0), sizes.length - 1)];
};

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
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const flat = useMemo(() => flattenWorkItems(workItems, projectName), [workItems, projectName]);
  const flatByKey = useMemo(() => new Map(flat.map((n) => [n.key, n])), [flat]);

  const activeNode = selectedKey ? flatByKey.get(selectedKey) ?? null : null;
  const hoverNode = !activeNode && hoveredKey ? flatByKey.get(hoveredKey) ?? null : null;
  const detailNode = activeNode ?? hoverNode;

  // ---------- 布局：递归银河（位置/半径/颜色由层级决定） ----------
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
        radius: nodeRadius(node.level),
        color: levelColor(node.level),
      });
    }
    for (const node of flat) {
      if (!node.parentKey) continue;
      edges.push({
        a: node.parentKey,
        b: node.key,
        salt: node.key,
        color: levelColor(node.level),
      });
    }
    let minY = 0;
    positions.forEach((pos) => {
      minY = Math.min(minY, pos.y);
    });
    return { nodes, edges, gridY: minY - 9 };
  }, [flat]);

  const renderTags = (tags?: string) => {
    if (!tags) return null;
    const tagList = tags.split(/[，,]/).map((t) => t.trim()).filter(Boolean);
    if (tagList.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {tagList.map((tag, idx) => (
          <Badge variant="secondary" key={`3d-tag-${idx}`}>
            {tag}
          </Badge>
        ))}
      </div>
    );
  };

  const renderMembers = (members?: string) => {
    if (!members) return null;
    const memberList = members.split(/[，,]/).map((m) => m.trim()).filter(Boolean);
    if (memberList.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {memberList.map((member, idx) => (
          <Badge variant="outline" key={`3d-member-${idx}`} className="border-primary/30 bg-accent text-primary">
            {member}
          </Badge>
        ))}
      </div>
    );
  };

  const detailStyle = detailNode ? getWorkStatusStyle(detailNode.status) : null;

  return (
    <GraphWorld
      nodes={layout.nodes}
      edges={layout.edges}
      selectedKey={selectedKey}
      hoveredKey={hoveredKey}
      onPick={setSelectedKey}
      onHoverKeyChange={setHoveredKey}
      grid={{ size: 300, y: layout.gridY, opacity: 0.4 }}
      toolbarBadge={(
        <Badge variant="secondary" className="ml-1">
          共 {flat.length} 个节点
        </Badge>
      )}
      legend={(
        <Card className="absolute bottom-4 left-4 z-10 max-w-[calc(100%-2rem)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {LEVEL_COLORS.map((color, index) => (
              <span key={`legend-${index}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                {LEVEL_NAMES[index]}
              </span>
            ))}
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MousePointer2Icon className="size-3.5" />
            左键拖拽旋转 · 滚轮缩放 · 右键拖拽平移 · 鼠标掠过与点击节点触发粒子
          </div>
        </Card>
      )}
    >
      {/* 详情卡片：悬浮或点击时显示（同工作导图右上角） */}
      {detailNode && (
        <Card className="absolute top-4 right-4 z-10 w-72 max-w-[calc(100%-2rem)]" style={{ maxHeight: 'calc(100% - 2rem)' }}>
          <CardHeader>
            <CardTitle>{detailNode.name}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="关闭详情" onClick={() => { setSelectedKey(null); setHoveredKey(null); }}>
                <XIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-1.5">
              {detailNode.status && detailStyle && (
                <Badge variant={detailStyle.badgeVariant} className={detailStyle.badgeClassName}>
                  {detailNode.status}
                </Badge>
              )}
              <Badge variant="outline">
                <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: levelColor(detailNode.level) }} />
                {LEVEL_NAMES[Math.min(detailNode.level, LEVEL_NAMES.length - 1)]}
              </Badge>
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
                {renderTags(detailNode.tags)}
              </div>
            )}
            {detailNode.members && (
              <div>
                <h4 className="mb-1 text-sm font-medium text-foreground">参与人员</h4>
                {renderMembers(detailNode.members)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </GraphWorld>
  );
}
