import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw as RefreshCwIcon,
  Radar as RadarIcon,
  List as ListIcon,
  Users as UsersIcon,
  FolderKanban as FolderKanbanIcon,
  FileText as FileTextIcon,
  CalendarDays as CalendarDaysIcon,
  TriangleAlert as TriangleAlertIcon,
  Sparkles as SparklesIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  fetchTeamDaily,
  fetchTeamGraph,
  fetchTeamWeekly,
  type TeamDailyReport,
  type TeamGraph,
  type TeamWeeklyReport,
} from '@/lib/services/team-reports';
import type { TeamNodeRef } from '@/components/team-reports/TeamReports3DGalaxy';

// 懒加载 3D 星图（three.js 体积大，单独分包，不进主包）
const TeamReports3DGalaxy = lazy(() => import('@/components/team-reports/TeamReports3DGalaxy'));

type RangeKey = '7d' | '30d' | 'week' | 'month';
type DetailKind = 'daily' | 'weekly' | 'monthly';

const toDateStr = (d: Date): string => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

function rangeBounds(key: RangeKey): { start: string; end: string } {
  const today = new Date();
  const end = toDateStr(today);
  if (key === '7d') return { start: toDateStr(new Date(today.getTime() - 6 * 86400000)), end };
  if (key === '30d') return { start: toDateStr(new Date(today.getTime() - 29 * 86400000)), end };
  if (key === 'week') {
    const offset = (today.getDay() + 6) % 7;
    return { start: toDateStr(new Date(today.getTime() - offset * 86400000)), end };
  }
  return { start: toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)), end };
}

export default function TeamReportsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d');
  const [view, setView] = useState<'3d' | 'list'>('3d');
  const [graph, setGraph] = useState<TeamGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [selected, setSelected] = useState<TeamNodeRef | null>(null);
  const [detailKind, setDetailKind] = useState<DetailKind>('daily');
  const [dailyRows, setDailyRows] = useState<TeamDailyReport[]>([]);
  const [weeklyRows, setWeeklyRows] = useState<TeamWeeklyReport[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const range = useMemo(() => rangeBounds(rangeKey), [rangeKey]);

  const loadGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const data = await fetchTeamGraph(range.start, range.end);
      setGraph(data);
    } catch (error) {
      setGraph(null);
      setGraphError(error instanceof Error ? error.message : '加载团队报告失败');
    } finally {
      setGraphLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph, refreshToken]);

  const loadDetail = useCallback(async () => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      if (detailKind === 'daily' || selected?.type === 'project') {
        const data = await fetchTeamDaily({
          start: range.start,
          end: range.end,
          user_id: selected?.type === 'member' ? selected.id : undefined,
          project_id: selected?.type === 'project' ? selected.id : undefined,
          limit: selected ? 120 : 60,
        });
        setDailyRows(data.reports);
        setWeeklyRows([]);
      } else {
        const data = await fetchTeamWeekly({
          kind: detailKind,
          start: range.start,
          end: range.end,
          user_id: selected?.type === 'member' ? selected.id : undefined,
          limit: selected ? 60 : 40,
        });
        setWeeklyRows(data.reports);
        setDailyRows([]);
      }
    } catch (error) {
      setDailyRows([]);
      setWeeklyRows([]);
      setDetailError(error instanceof Error ? error.message : '加载明细失败');
    } finally {
      setDetailLoading(false);
    }
  }, [detailKind, selected, range.start, range.end]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, refreshToken]);

  const selectedMember = selected?.type === 'member' ? graph?.members.find((m) => m.id === selected.id) ?? null : null;
  const selectedProject = selected?.type === 'project' ? graph?.projects.find((p) => p.id === selected.id) ?? null : null;

  const projectDailyCount = useMemo(() => {
    if (!selectedProject) return 0;
    return dailyRows.reduce((sum, report) => {
      const matched = report.items.filter((it) => it.project_id === selectedProject.id).length;
      return sum + matched;
    }, 0);
  }, [dailyRows, selectedProject]);

  const topMembers = useMemo(
    () => (graph ? [...graph.members].sort((a, b) => b.item_count - a.item_count).slice(0, 6) : []),
    [graph],
  );
  const topProjects = useMemo(
    () => (graph ? [...graph.projects].sort((a, b) => b.item_count - a.item_count).slice(0, 6) : []),
    [graph],
  );

  const handlePick = useCallback((node: TeamNodeRef | null) => {
    setSelected(node);
    if (node?.type === 'project') setDetailKind('daily');
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RadarIcon className="size-5 text-primary" />
            团队报告星图
          </CardTitle>
          <CardDescription>
            管理员视角：查看全体人员的日报与周报，点击 3D 星图中的项目或人员节点查看明细。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Tabs value={rangeKey} onValueChange={(v) => setRangeKey(v as RangeKey)}>
            <TabsList>
              <TabsTrigger value="7d">近 7 天</TabsTrigger>
              <TabsTrigger value="30d">近 30 天</TabsTrigger>
              <TabsTrigger value="week">本周</TabsTrigger>
              <TabsTrigger value="month">本月</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={view} onValueChange={(v) => setView(v as '3d' | 'list')}>
            <TabsList>
              <TabsTrigger value="3d">
                <SparklesIcon className="mr-1 size-4" />
                3D 星图
              </TabsTrigger>
              <TabsTrigger value="list">
                <ListIcon className="mr-1 size-4" />
                明细列表
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDaysIcon className="size-3.5" />
            {range.start} ~ {range.end}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setRefreshToken((v) => v + 1)}
            disabled={graphLoading}
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
        </CardContent>
      </Card>

      {graphError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="size-4" />
            {graphError}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {graphLoading && !graph ? (
            <Card>
              <CardContent className="flex h-120 items-center justify-center gap-3">
                <Spinner />
                <span className="text-sm text-muted-foreground">正在构建团队报告星图…</span>
              </CardContent>
            </Card>
          ) : view === '3d' && graph ? (
            <Suspense
              fallback={(
                <Card>
                  <CardContent className="flex h-120 items-center justify-center gap-3">
                    <Spinner />
                    <span className="text-sm text-muted-foreground">正在构建团队报告星图…</span>
                  </CardContent>
                </Card>
              )}
            >
              <TeamReports3DGalaxy graph={graph} selected={selected} onPick={handlePick} />
            </Suspense>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {selectedProject
                    ? `项目日报：${selectedProject.name}`
                    : selectedMember
                      ? `${selectedMember.name} 的报告`
                      : '全员报告明细'}
                </CardTitle>
                <CardDescription>
                  {selectedProject
                    ? '该项目在所有人员日报中出现的条目'
                    : '按日期倒序展示，最多显示最近若干条'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DetailBody
                  detailKind={detailKind}
                  setDetailKind={setDetailKind}
                  loading={detailLoading}
                  error={detailError}
                  dailyRows={dailyRows}
                  weeklyRows={weeklyRows}
                  projectId={selectedProject?.id ?? null}
                  compact={false}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersIcon className="size-4 text-primary" />
                {selectedProject ? '项目详情' : selectedMember ? '人员详情' : '团队概览'}
              </CardTitle>
              <CardDescription>
                {selectedProject
                  ? `${selectedProject.code} · 负责人 ${selectedProject.owner_name}`
                  : selectedMember
                    ? selectedMember.email
                    : `统计区间 ${range.start} ~ ${range.end}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedProject ? (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={selectedProject.is_active ? 'secondary' : 'outline'}>
                    {selectedProject.is_active ? '进行中' : '已归档'}
                  </Badge>
                  <Badge variant="outline">{selectedProject.item_count} 条日报</Badge>
                  <Badge variant="outline">{selectedProject.member_count} 人参与</Badge>
                  {selectedProject.last_date && <Badge variant="outline">最近 {selectedProject.last_date}</Badge>}
                  <Badge variant="outline">本期命中 {projectDailyCount} 条</Badge>
                </div>
              ) : selectedMember ? (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{selectedMember.daily_count} 篇日报</Badge>
                  <Badge variant="outline">{selectedMember.item_count} 条记录</Badge>
                  <Badge variant="outline">{selectedMember.weekly_count} 篇周报</Badge>
                  <Badge variant="outline">{selectedMember.monthly_count} 篇月报</Badge>
                  {selectedMember.last_date && <Badge variant="secondary">最近提交 {selectedMember.last_date}</Badge>}
                </div>
              ) : graph ? (
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="成员" value={graph.totals.members} />
                  <StatTile label="项目" value={graph.totals.projects} />
                  <StatTile label="日报" value={graph.totals.daily_reports} />
                  <StatTile label="日报条目" value={graph.totals.items} />
                </div>
              ) : null}

              {selected && (
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  取消选中，回到团队概览
                </Button>
              )}

              {!selected && graph && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground">活跃度排行</h4>
                  <div className="space-y-1.5">
                    {topMembers.map((member) => (
                      <button
                        key={`rank-member-${member.id}`}
                        type="button"
                        onClick={() => handlePick({ type: 'member', id: member.id })}
                        className="flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-xs transition hover:bg-accent"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <UsersIcon className="size-3.5 shrink-0 text-cyan-500" />
                          <span className="truncate">{member.name}</span>
                        </span>
                        <span className="text-muted-foreground">{member.item_count} 条</span>
                      </button>
                    ))}
                  </div>
                  <h4 className="pt-1 text-sm font-medium text-foreground">项目活跃度</h4>
                  <div className="space-y-1.5">
                    {topProjects.map((project) => (
                      <button
                        key={`rank-project-${project.id}`}
                        type="button"
                        onClick={() => handlePick({ type: 'project', id: project.id })}
                        className="flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-xs transition hover:bg-accent"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <FolderKanbanIcon className="size-3.5 shrink-0 text-violet-500" />
                          <span className="truncate">{project.name}</span>
                        </span>
                        <span className="text-muted-foreground">{project.item_count} 条</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {(selectedMember || selectedProject) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileTextIcon className="size-4 text-primary" />
                  {selectedProject ? '该项目日报' : '报告明细'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DetailBody
                  detailKind={selectedProject ? 'daily' : detailKind}
                  setDetailKind={setDetailKind}
                  loading={detailLoading}
                  error={detailError}
                  dailyRows={dailyRows}
                  weeklyRows={weeklyRows}
                  projectId={selectedProject?.id ?? null}
                  compact
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

interface DetailBodyProps {
  detailKind: DetailKind;
  setDetailKind: (kind: DetailKind) => void;
  loading: boolean;
  error: string | null;
  dailyRows: TeamDailyReport[];
  weeklyRows: TeamWeeklyReport[];
  projectId: string | null;
  compact: boolean;
}

function DetailBody({
  detailKind,
  setDetailKind,
  loading,
  error,
  dailyRows,
  weeklyRows,
  projectId,
  compact,
}: DetailBodyProps) {
  return (
    <div className="space-y-3">
      {!projectId && (
        <Tabs value={detailKind} onValueChange={(v) => setDetailKind(v as DetailKind)}>
          <TabsList>
            <TabsTrigger value="daily">日报</TabsTrigger>
            <TabsTrigger value="weekly">周报</TabsTrigger>
            <TabsTrigger value="monthly">月报</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {loading && (
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          <TriangleAlertIcon className="size-4" />
          {error}
        </div>
      )}

      {!loading && !error && detailKind === 'daily' && (
        <>
          {dailyRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">该区间没有日报记录</p>
          ) : (
            <div className={compact ? 'max-h-140 space-y-3 overflow-y-auto pr-1' : 'space-y-3'}>
              {dailyRows.map((report) => {
                const items = projectId ? report.items.filter((it) => it.project_id === projectId) : report.items;
                if (projectId && items.length === 0) return null;
                return (
                  <div key={report.id} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{report.user_name}</Badge>
                      <span className="text-xs text-muted-foreground">{report.date}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{items.length} 条</span>
                    </div>
                    <ul className="space-y-1.5">
                      {items.map((item) => (
                        <li key={item.id} className="rounded-md bg-muted/50 px-2 py-1.5 text-sm">
                          <span className="mr-1.5 text-xs text-primary">
                            {item.projects?.name ?? '未关联项目'}
                          </span>
                          <span className="text-foreground">{item.content}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {!loading && !error && detailKind !== 'daily' && (
        <>
          {weeklyRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              该区间没有{detailKind === 'weekly' ? '周报' : '月报'}记录
            </p>
          ) : (
            <div className={compact ? 'max-h-140 space-y-3 overflow-y-auto pr-1' : 'space-y-3'}>
              {weeklyRows.map((report) => (
                <div key={report.id} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{report.user_name}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {report.year} 年{report.week_number ? ` 第 ${report.week_number} 周` : ` ${report.month} 月`}
                      （{report.start_date} ~ {report.end_date}）
                    </span>
                    {report.status && <Badge variant="outline">{report.status === 'draft' ? '草稿' : '已生成'}</Badge>}
                  </div>
                  {report.content ? (
                    <p className="text-sm whitespace-pre-wrap text-foreground">{report.content}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(report.items ?? []).map((item) => (
                        <li key={item.id} className="rounded-md bg-muted/50 px-2 py-1.5 text-sm">
                          <span className="mr-1.5 text-xs text-primary">{item.projects?.name ?? '未关联项目'}</span>
                          <span className="text-foreground">{item.content}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
