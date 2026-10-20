import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import GraphWorld, {
  type GraphWorldEdgeInput,
  type GraphWorldNodeInput,
} from '@/components/three/GraphWorld';
import { GraphDetailCard, DetailStat, GraphLegendCard } from '@/components/three/GraphHud';
import {
  TREE_DENSE_VISUALS,
  TREE_INACTIVE_COLOR,
  TREE_LEVEL_COLORS,
  TREE_VIEWPORT_CLASS,
  treeGrid,
  treeNodeRadius,
} from '@/components/three/tree-theme';
import { useGraphHover } from '@/components/three/use-graph-hover';
import { Badge } from '@/components/ui/badge';
import type { TeamGraph } from '@/lib/services/team-reports';

export type TeamNodeRef = { type: 'member' | 'project'; id: string };

interface TeamReports3DGalaxyProps {
  graph: TeamGraph;
  selected: TeamNodeRef | null;
  onPick: (node: TeamNodeRef | null) => void;
}

const MAX_LINKS = 600;

// 与工作分解 3D 世界共用同一套层级配色：核心=项目蓝，人员=1级绿，项目=2级琥珀
const CORE_COLOR = TREE_LEVEL_COLORS[0];
const MEMBER_ACTIVE = TREE_LEVEL_COLORS[1];
const PROJECT_ACTIVE = TREE_LEVEL_COLORS[2];
const CORE_KEY = 'core:__core__';
const CORE_EDGE_ACTIVE = `#${new THREE.Color(MEMBER_ACTIVE).lerp(new THREE.Color('#ffffff'), 0.225).getHexString()}`;
const CORE_EDGE_IDLE = `#${new THREE.Color(MEMBER_ACTIVE).lerp(new THREE.Color('#ffffff'), 0.081).getHexString()}`;

const isPickableKey = (key: string): boolean => key !== CORE_KEY;

export default function TeamReports3DGalaxy({ graph, selected, onPick }: TeamReports3DGalaxyProps) {
  const { hoveredKey, onHoverKeyChange, detailHoverProps, clearHover } = useGraphHover();

  const selectedKey = selected ? `${selected.type}:${selected.id}` : null;

  const handleEnginePick = useCallback(
    (key: string | null) => {
      if (!key) {
        onPick(null);
        return;
      }
      const splitAt = key.indexOf(':');
      if (splitAt < 0) {
        onPick(null);
        return;
      }
      const type = key.slice(0, splitAt);
      if (type !== 'member' && type !== 'project') {
        onPick(null);
        return;
      }
      onPick({ type, id: key.slice(splitAt + 1) });
    },
    [onPick],
  );

  const selectedLabel = useMemo(() => {
    if (!selected) return null;
    if (selected.type === 'member') {
      return graph.members.find((m) => m.id === selected.id)?.name ?? null;
    }
    return graph.projects.find((p) => p.id === selected.id)?.name ?? null;
  }, [selected, graph]);

  // 详情卡片：选中优先，未选中时跟随鼠标悬浮（与工作分解 3D 世界行为一致）
  const detailRef = useMemo<TeamNodeRef | null>(() => {
    if (selected) return selected;
    if (!hoveredKey) return null;
    const splitAt = hoveredKey.indexOf(':');
    if (splitAt < 0) return null;
    const type = hoveredKey.slice(0, splitAt);
    if (type !== 'member' && type !== 'project') return null;
    return { type, id: hoveredKey.slice(splitAt + 1) };
  }, [selected, hoveredKey]);

  const detailMember = detailRef?.type === 'member' ? graph.members.find((m) => m.id === detailRef.id) ?? null : null;
  const detailProject = detailRef?.type === 'project' ? graph.projects.find((p) => p.id === detailRef.id) ?? null : null;

  const detailLinks = useMemo(() => {
    if (!detailRef) return [];
    return detailRef.type === 'member'
      ? graph.links.filter((link) => link.user_id === detailRef.id)
      : graph.links.filter((link) => link.project_id === detailRef.id);
  }, [detailRef, graph.links]);

  const detailRelated = useMemo(() => {
    if (!detailRef) return [] as RelatedItem[];
    if (detailRef.type === 'member') {
      return sortRelated(
        detailLinks.map((link) => {
          const project = graph.projects.find((p) => p.id === link.project_id);
          return project
            ? { id: project.id, label: project.name, itemCount: link.item_count, lastDate: link.last_date }
            : null;
        }),
      );
    }
    return sortRelated(
      detailLinks.map((link) => {
        const member = graph.members.find((m) => m.id === link.user_id);
        return member
          ? { id: member.id, label: member.name, itemCount: link.item_count, lastDate: link.last_date }
          : null;
      }),
    );
  }, [detailRef, detailLinks, graph.members, graph.projects]);

  const closeDetail = useCallback(() => {
    clearHover();
    onPick(null);
  }, [clearHover, onPick]);

  // ---------- 布局：中心团队核心 → 人员环 → 项目环 ----------
  const layout = useMemo(() => {
    const nodes: GraphWorldNodeInput[] = [];
    const edges: GraphWorldEdgeInput[] = [];
    const white = new THREE.Color('#ffffff');

    nodes.push({
      key: CORE_KEY,
      label: '团队报告',
      sublabel: `${graph.totals.members} 人 · ${graph.totals.projects} 项目`,
      base: new THREE.Vector3(0, 0, 0),
      radius: treeNodeRadius(0),
      color: CORE_COLOR,
      activity: 1,
    });

    // 人员：内环（最多每环 12 人）
    const memberRingRadius = 32;
    const membersSorted = [...graph.members].sort((a, b) => b.item_count - a.item_count);
    membersSorted.forEach((member, index) => {
      const ring = Math.floor(index / 12);
      const inRing = index % 12;
      const count = Math.min(12, membersSorted.length - ring * 12);
      const angle = (inRing / Math.max(1, count)) * Math.PI * 2 + ring * 0.4;
      const radius = memberRingRadius + ring * 14;
      const y = Math.sin(index * 1.7) * 5 + ring * 1.5;
      const active = member.item_count > 0;
      nodes.push({
        key: `member:${member.id}`,
        label: active || member.daily_count > 0 ? member.name : null,
        sublabel: `${member.daily_count} 日报 · ${member.item_count} 条`,
        labelAccent: active ? MEMBER_ACTIVE : TREE_INACTIVE_COLOR,
        base: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
        radius: treeNodeRadius(1) + Math.min(member.item_count, 30) * 0.03,
        color: active ? MEMBER_ACTIVE : TREE_INACTIVE_COLOR,
        activity: Math.min(1, member.item_count / 20),
      });
    });

    // 项目：外环（最多每环 16 个）
    const projectRingRadius = 78;
    const projectsSorted = [...graph.projects].sort((a, b) => b.item_count - a.item_count);
    projectsSorted.forEach((project, index) => {
      const ring = Math.floor(index / 16);
      const inRing = index % 16;
      const count = Math.min(16, projectsSorted.length - ring * 16);
      const angle = (inRing / Math.max(1, count)) * Math.PI * 2 - ring * 0.35;
      const radius = projectRingRadius + ring * 22;
      const y = Math.cos(index * 2.1) * 8 - ring * 2;
      const active = project.item_count > 0;
      nodes.push({
        key: `project:${project.id}`,
        label: active ? project.name : null,
        sublabel: `${project.item_count} 条 · ${project.member_count} 人`,
        labelAccent: active ? PROJECT_ACTIVE : TREE_INACTIVE_COLOR,
        base: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
        radius: treeNodeRadius(2) + Math.min(project.item_count, 40) * 0.03,
        color: active ? PROJECT_ACTIVE : TREE_INACTIVE_COLOR,
        activity: Math.min(1, project.item_count / 30),
      });
    });

    // 核心 → 人员弱边（全量）
    for (const member of graph.members) {
      edges.push({
        a: CORE_KEY,
        b: `member:${member.id}`,
        salt: `core-${member.id}`,
        color: member.item_count > 0 ? CORE_EDGE_ACTIVE : CORE_EDGE_IDLE,
        highlightLevel: 0.75,
      });
    }

    // 人员 → 项目加权边（按条目数 Top N）
    const strongLinks = [...graph.links]
      .sort((a, b) => b.item_count - a.item_count)
      .slice(0, MAX_LINKS);
    for (const link of strongLinks) {
      const strength = Math.min(1, 0.25 + link.item_count / 12);
      edges.push({
        a: `member:${link.user_id}`,
        b: `project:${link.project_id}`,
        salt: `link-${link.user_id}-${link.project_id}`,
        color: `#${new THREE.Color(PROJECT_ACTIVE).lerp(white, strength * 0.45).getHexString()}`,
      });
    }

    let minY = 0;
    for (const node of nodes) minY = Math.min(minY, node.base.y);
    return { nodes, edges, minY };
  }, [graph]);

  return (
    <GraphWorld
      nodes={layout.nodes}
      edges={layout.edges}
      selectedKey={selectedKey}
      hoveredKey={hoveredKey}
      onPick={handleEnginePick}
      onHoverKeyChange={onHoverKeyChange}
      isPickableKey={isPickableKey}
      dimUnrelated
      visuals={TREE_DENSE_VISUALS}
      grid={treeGrid(layout.minY)}
      viewportClassName={TREE_VIEWPORT_CLASS}
      toolbarBadge={(
        <Badge variant="secondary" className="ml-1">
          {graph.totals.members} 人 · {graph.totals.projects} 项目 · {graph.totals.items} 条
        </Badge>
      )}
      legend={(
        <GraphLegendCard
          items={[
            { color: CORE_COLOR, label: '团队核心' },
            { color: MEMBER_ACTIVE, label: '人员（有日报）' },
            { color: PROJECT_ACTIVE, label: '项目（有日报）' },
            { color: TREE_INACTIVE_COLOR, label: '本期无记录' },
          ]}
          hint={
            selectedLabel
              ? `已选：${selectedLabel}（点击空白取消）`
              : '悬浮或点击人员/项目查看详情 · 拖拽旋转 · 滚轮缩放'
          }
        />
      )}
    >
      {/* 详情卡片：悬浮或点击节点时显示（与工作分解 3D 世界共用同一套卡片样式） */}
      {detailRef && (detailMember || detailProject) && (
        <GraphDetailCard
          title={detailMember?.name ?? detailProject?.name ?? ''}
          onClose={closeDetail}
          hoverProps={detailHoverProps}
        >
          {detailMember && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={detailMember.item_count > 0 ? 'secondary' : 'outline'}>
                  {detailMember.item_count > 0 ? '本期活跃' : '本期无记录'}
                </Badge>
                {detailMember.role.map((role) => (
                  <Badge key={`role-${role}`} variant="outline">
                    {role === 'admin' ? '管理员' : '成员'}
                  </Badge>
                ))}
              </div>
              <p className="text-xs break-all text-muted-foreground">{detailMember.email}</p>
              <div className="grid grid-cols-2 gap-2">
                <DetailStat label="日报" value={detailMember.daily_count} />
                <DetailStat label="日报条目" value={detailMember.item_count} />
                <DetailStat label="周报" value={detailMember.weekly_count} />
                <DetailStat label="月报" value={detailMember.monthly_count} />
              </div>
              {detailMember.last_date && (
                <p className="text-xs text-muted-foreground">最近提交日期：{detailMember.last_date}</p>
              )}
              {detailMember.last_report_edit_at && (
                <p className="text-xs text-muted-foreground">
                  最近编辑：{formatDateTime(detailMember.last_report_edit_at)}
                </p>
              )}
              <DetailRelatedList title="参与项目" items={detailRelated} emptyText="本期未关联项目" />
            </>
          )}

          {detailProject && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={detailProject.is_active ? 'secondary' : 'outline'}>
                  {detailProject.is_active ? '进行中' : '已归档'}
                </Badge>
                <Badge variant="outline">{detailProject.code}</Badge>
                <Badge variant={detailProject.item_count > 0 ? 'secondary' : 'outline'}>
                  {detailProject.item_count > 0 ? '本期有记录' : '本期无记录'}
                </Badge>
              </div>
              <p className="text-xs break-all text-muted-foreground">负责人：{detailProject.owner_name}</p>
              <div className="grid grid-cols-2 gap-2">
                <DetailStat label="日报条目" value={detailProject.item_count} />
                <DetailStat label="参与人数" value={detailProject.member_count} />
              </div>
              {detailProject.last_date && (
                <p className="text-xs text-muted-foreground">最近记录日期：{detailProject.last_date}</p>
              )}
              <DetailRelatedList title="参与人员" items={detailRelated} emptyText="本期无人员记录" />
            </>
          )}
        </GraphDetailCard>
      )}
    </GraphWorld>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface RelatedItem {
  id: string;
  label: string;
  itemCount: number;
  lastDate: string;
}

function sortRelated(items: (RelatedItem | null)[]): RelatedItem[] {
  return items
    .filter((item): item is RelatedItem => item !== null)
    .sort((a, b) => b.itemCount - a.itemCount);
}

function DetailRelatedList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: RelatedItem[];
  emptyText: string;
}) {
  const shown = items.slice(0, 6);
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium text-foreground">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((item) => (
            <li
              key={`related-${item.id}`}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              <span className="min-w-0 truncate text-foreground">{item.label}</span>
              <span className="shrink-0 text-muted-foreground">
                {item.itemCount} 条 · {item.lastDate}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.length > shown.length && (
        <p className="mt-1 text-xs text-muted-foreground">另有 {items.length - shown.length} 项未显示</p>
      )}
    </div>
  );
}
