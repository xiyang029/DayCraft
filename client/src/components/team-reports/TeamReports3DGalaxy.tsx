import { useCallback, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  MousePointer2 as MousePointer2Icon,
  X as XIcon,
} from 'lucide-react';
import GraphWorld, {
  type GraphWorldEdgeInput,
  type GraphWorldNodeInput,
  type GraphWorldVisuals,
} from '@/components/three/GraphWorld';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TeamGraph } from '@/lib/services/team-reports';

export type TeamNodeRef = { type: 'member' | 'project'; id: string };

interface TeamReports3DGalaxyProps {
  graph: TeamGraph;
  selected: TeamNodeRef | null;
  onPick: (node: TeamNodeRef | null) => void;
}

const MAX_LINKS = 600;
const CORE_COLOR = '#fef3c7';
const MEMBER_ACTIVE = '#22d3ee';
const MEMBER_IDLE = '#475569';
const PROJECT_ACTIVE = '#a855f7';
const PROJECT_IDLE = '#334155';
const CORE_KEY = 'core:__core__';

const GALAXY_VISUALS: GraphWorldVisuals = {
  fogDensity: 0.0019,
  cameraFar: 3000,
  minDistance: 12,
  maxDistance: 420,
  rotateSpeed: 0.45,
  hemiIntensity: 0.95,
  dirIntensity: 1.2,
  dirPosition: [60, 90, 40],
  coreLightColor: '#ffe9b5',
  coreLightIntensity: 120,
  coreLightDistance: 260,
  skyRadius: 1400,
  dustCount: 600,
  dustInner: 60,
  dustOuter: 460,
  scanColors: ['#22d3ee', '#a855f7', '#f59e0b'],
  scanY: 0,
  scanRadius: (r: number) => r * 1.25 + 20,
  bloomStrength: 0.6,
  bloomRadius: 0.75,
  bloomThreshold: 0.66,
  edgeSegments: 6,
  maxSparks: 1400,
  introDuration: 1.8,
  glowFactor: 7.2,
  glowBoostFactor: 3,
  labelLift: 2.4,
  labelStyle: { fontSize: 46, padX: 72, maxLength: 10 },
  homeMinDistance: 0,
  homeDistanceFactor: 1.85,
  homeDir: [0.62, 0.5, 1],
  introStartScale: 0.42,
  introSpin: -0.9,
};

const GALAXY_VIEWPORT_CLASS =
  'h-[calc(100dvh-330px)] min-h-120 w-full bg-[#050a18] sm:h-[calc(100dvh-300px)] lg:h-[calc(100dvh-280px)]';

const isPickableKey = (key: string): boolean => key !== CORE_KEY;

export default function TeamReports3DGalaxy({ graph, selected, onPick }: TeamReports3DGalaxyProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

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
    if (!detailRef) return [] as { id: string; label: string; itemCount: number; lastDate: string }[];
    if (detailRef.type === 'member') {
      return detailLinks
        .map((link) => {
          const project = graph.projects.find((p) => p.id === link.project_id);
          if (!project) return null;
          return { id: project.id, label: project.name, itemCount: link.item_count, lastDate: link.last_date };
        })
        .filter((item): item is { id: string; label: string; itemCount: number; lastDate: string } => item !== null)
        .sort((a, b) => b.itemCount - a.itemCount);
    }
    return detailLinks
      .map((link) => {
        const member = graph.members.find((m) => m.id === link.user_id);
        if (!member) return null;
        return { id: member.id, label: member.name, itemCount: link.item_count, lastDate: link.last_date };
      })
      .filter((item): item is { id: string; label: string; itemCount: number; lastDate: string } => item !== null)
      .sort((a, b) => b.itemCount - a.itemCount);
  }, [detailRef, detailLinks, graph.members, graph.projects]);

  const closeDetail = useCallback(() => {
    setHoveredKey(null);
    onPick(null);
  }, [onPick]);

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
      radius: 3.0,
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
        labelAccent: MEMBER_ACTIVE,
        base: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
        radius: 1.5 + Math.min(member.item_count, 30) * 0.045,
        color: active ? MEMBER_ACTIVE : MEMBER_IDLE,
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
        base: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
        radius: 1.8 + Math.min(project.item_count, 40) * 0.045,
        color: active ? PROJECT_ACTIVE : PROJECT_IDLE,
        activity: Math.min(1, project.item_count / 30),
      });
    });

    // 核心 → 人员弱边（全量）
    for (const member of graph.members) {
      const strength = member.item_count > 0 ? 0.5 : 0.18;
      edges.push({
        a: CORE_KEY,
        b: `member:${member.id}`,
        salt: `core-${member.id}`,
        color: `#${new THREE.Color(MEMBER_ACTIVE).lerp(white, strength * 0.45).getHexString()}`,
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

    const outerRadius = projectRingRadius + Math.max(0, Math.floor(Math.max(0, projectsSorted.length - 1) / 16)) * 22;
    const boundingRadius = outerRadius + 30;
    return {
      nodes,
      edges,
      grid: {
        size: Math.max(240, boundingRadius * 4),
        y: -boundingRadius * 0.75,
        opacity: 0.32,
      },
    };
  }, [graph]);

  return (
    <GraphWorld
      nodes={layout.nodes}
      edges={layout.edges}
      selectedKey={selectedKey}
      hoveredKey={hoveredKey}
      onPick={handleEnginePick}
      onHoverKeyChange={setHoveredKey}
      isPickableKey={isPickableKey}
      dimUnrelated
      visuals={GALAXY_VISUALS}
      grid={layout.grid}
      viewportClassName={GALAXY_VIEWPORT_CLASS}
      toolbarBadge={(
        <Badge variant="secondary" className="ml-1">
          {graph.totals.members} 人 · {graph.totals.projects} 项目 · {graph.totals.items} 条
        </Badge>
      )}
      legend={(
        <Card className="absolute right-4 bottom-4 left-4 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:left-auto">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: CORE_COLOR, boxShadow: `0 0 8px ${CORE_COLOR}` }} />
            团队核心
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: MEMBER_ACTIVE, boxShadow: `0 0 8px ${MEMBER_ACTIVE}` }} />
            人员（有日报）
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: PROJECT_ACTIVE, boxShadow: `0 0 8px ${PROJECT_ACTIVE}` }} />
            项目（有日报）
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="inline-block size-2.5 rounded-full bg-slate-500" />
            本期无记录
          </span>
          <span className="inline-flex w-full items-center gap-1 text-xs text-muted-foreground sm:w-auto">
            <MousePointer2Icon className="size-3.5" />
            {selectedLabel ? `已选：${selectedLabel}（点击空白取消）` : '悬浮或点击人员/项目查看详情 · 拖拽旋转 · 滚轮缩放'}
          </span>
        </Card>
      )}
    >
      {/* 详情卡片：悬浮或点击节点时显示（同工作分解 3D 世界右上角） */}
      {detailRef && (detailMember || detailProject) && (
        <Card className="absolute top-4 right-4 z-10 w-72 max-w-[calc(100%-2rem)]" style={{ maxHeight: 'calc(100% - 2rem)' }}>
          <CardHeader>
            <CardTitle className="truncate">{detailMember?.name ?? detailProject?.name}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="关闭详情" onClick={closeDetail}>
                <XIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto">
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
          </CardContent>
        </Card>
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

function DetailStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function DetailRelatedList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: { id: string; label: string; itemCount: number; lastDate: string }[];
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
