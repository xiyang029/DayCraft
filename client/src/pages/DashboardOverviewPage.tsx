
import { useEffect, useState, useRef, useCallback } from "react";
import { BarChart3Icon, CalendarIcon, FileTextIcon, FolderIcon, PencilIcon } from "lucide-react";
import { useAuth } from "../contexts/auth-context";
import { apiGet } from "../lib/api";
import { format, startOfWeek, endOfWeek, startOfMonth, parseISO, getWeek } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Project } from "../lib/db/types";
import { Link } from 'react-router-dom';
import { usePersistentState } from '../lib/utils/page-persistence';
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";


interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface WorkItem {
  content: string;
  project: Project;
}

interface Report {
  id: string;
  date: string;
  status: string;
  workItems: WorkItem[];
}

interface Stats {
  weeklyReportCount: number;
  pendingWeeklyReports: number;
  projectCount: number;
  monthlyWorkItemCount: number;
}

export default function DashboardOverview() {
  const { user: authUser, profile: authProfile, loading } = useAuth();
  
  // 使用持久化状态替代普通状态
  const [user, setUser] = usePersistentState<User | null>('dashboard-overview-user', null);
  const [reports, setReports] = usePersistentState<Report[]>('dashboard-overview-reports', []);
  const [, setProjects] = usePersistentState<Project[]>('dashboard-overview-projects', []);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = usePersistentState<Stats>('dashboard-overview-stats', {
    weeklyReportCount: 0,
    pendingWeeklyReports: 0,
    projectCount: 0,
    monthlyWorkItemCount: 0
  });
  
  // 添加预览相关状态
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewReport, setPreviewReport] = useState<Report | null>(null);
  
  // 添加钉钉相关状态

  // 添加数据已加载的引用
  const dataLoadedRef = useRef(false);
  // 添加最后数据加载时间戳
  const lastLoadTimeRef = useRef<number>(0);
  // 数据刷新间隔（毫秒），设置为5分钟
  const DATA_REFRESH_INTERVAL = 5 * 60 * 1000;

  // 获取项目数据
  const fetchProjects = useCallback(async () => {
    try {
      const data = await apiGet<{ projects: Project[] }>('/api/projects?active_only=true');

      setProjects(data.projects || []);
      return data.projects;
    } catch (error) {
      console.error("获取项目数据失败", error);
      return [];
    }
  }, [setProjects]);

  // 获取最近日报
  const fetchRecentReports = useCallback(async () => {
    try {
      const data = await apiGet<{ reports: any[] }>('/api/daily-reports?with_items=1');

      // 使用类型断言处理数据
      const formattedReports = (data.reports || []).slice(0, 6).map(report => ({
        id: report.id as string,
        date: report.date as string,
        status: '已提交',
        workItems: ((report.report_items || []) as unknown as any[]).map((item: any) => ({
          content: item.content as string,
          project: item.projects as Project
        }))
      }));
      
      setReports(formattedReports);
      return formattedReports;
    } catch (error) {
      console.error("获取最近日报失败", error);
      return [];
    }
  }, [setReports]);

  // 获取统计数据
  const fetchStats = useCallback(async () => {
    try {
      // 获取本周日报数量
      const today = new Date();
      const weekStart = format(startOfWeek(today, { locale: zhCN }), 'yyyy-MM-dd');
      const weekEnd = format(endOfWeek(today, { locale: zhCN }), 'yyyy-MM-dd');

      const weekData = await apiGet<{ reports: Array<{ date: string }> }>(
        `/api/daily-reports?start=${weekStart}&end=${weekEnd}`
      );
      const weeklyReports = weekData.reports;

      // 获取本月工作项数量
      const monthStart = format(startOfMonth(today), 'yyyy-MM-dd');

      const monthData = await apiGet<{ reports: Array<{ report_items: unknown[] }> }>(
        `/api/daily-reports?start=${monthStart}&end=${format(today, 'yyyy-MM-dd')}&with_items=1`
      );
      const monthlyItems = monthData.reports;

      // 计算本月工作项总数
      let monthlyWorkItemCount = 0;
      monthlyItems?.forEach(report => {
        monthlyWorkItemCount += (report.report_items || []).length;
      });

      // 获取当前周的周报是否已生成
      const currentYear = today.getFullYear();
      const currentWeek = getWeek(today, { locale: zhCN });

      const weeklyList = await apiGet<{ reports: Array<{ year: number; week_number: number }> }>(
        '/api/weekly-reports'
      );
      const existingWeeklyReport = weeklyList.reports.find(
        r => r.year === currentYear && r.week_number === currentWeek
      ) || null;

      // 只有当本周有日报记录且周报尚未生成时，才显示待生成周报
      const pendingWeeklyReports = (weeklyReports && weeklyReports.length > 0 && !existingWeeklyReport) ? 1 : 0;

      // 获取项目数量
      const projectData = await apiGet<{ projects: unknown[]; total: number }>('/api/projects?active_only=true');
      const projectCount = projectData.total;

      setStats({
        weeklyReportCount: weeklyReports?.length || 0,
        pendingWeeklyReports,
        projectCount: projectCount || 0,
        monthlyWorkItemCount
      });

    } catch (error) {
      console.error("获取统计数据失败", error);
    }
  }, [setStats]);

  // 获取所有数据
  const fetchData = useCallback(async () => {
    if (dataLoadedRef.current) {
      console.log('数据已加载，跳过重新获取');
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    try {
      // 并行请求数据
      await Promise.all([
        fetchProjects(),
        fetchRecentReports(),
        fetchStats()
      ]);
      
      // 标记数据已加载
      dataLoadedRef.current = true;
    } catch (error) {
      console.error("获取数据失败", error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchProjects, fetchRecentReports, fetchStats]);

  useEffect(() => {
    // 使用本地会话的用户信息，名称优先取用户资料里的真实姓名
    if (authUser && !dataLoadedRef.current) {
      setUser({
        id: authUser.id,
        name: authProfile?.full_name || authUser.email?.split('@')[0] || '用户',
        email: authUser.email || '',
        role: 'user'
      });
      
      // 检查数据是否需要重新加载
      const now = Date.now();
      const timeSinceLastLoad = now - lastLoadTimeRef.current;
      
      // 如果数据未加载或超过刷新间隔，则加载数据
      if (!dataLoadedRef.current || timeSinceLastLoad > DATA_REFRESH_INTERVAL) {
        fetchData();
        lastLoadTimeRef.current = now;
      } else {
        // 如果数据已加载且未超过刷新间隔，则直接设置加载状态为false
        setIsLoading(false);
      }
    }
  }, [authUser, authProfile, setUser, fetchData]);

  // 添加页面可见性监听
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('概览页面恢复可见，检查数据状态');
          // 只检查数据是否存在，不重新加载
          if (authUser && (!user || reports.length === 0)) {
            console.log('数据不存在，重新加载');
            dataLoadedRef.current = false;
            fetchData();
          }
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [authUser, user, reports, fetchData]);



  // 获取报告涉及的所有项目
  const getReportProjects = (report: Report) => {
    const projectMap = new Map<string, Project>();
    
    report.workItems.forEach(item => {
      if (item.project && !projectMap.has(item.project.id)) {
        projectMap.set(item.project.id, item.project);
      }
    });
    
    return Array.from(projectMap.values());
  };

  // 根据项目ID获取该项目的工作项
  const getProjectWorkItems = (report: Report, projectId: string) => {
    return report.workItems.filter(item => item.project?.id === projectId);
  };

  // 生成统计卡片数据
  const generateStatsCards = () => {
    return [
      {
        id: 1,
        name: "本周填写日报",
        value: stats.weeklyReportCount.toString(),
        unit: "天",
        icon: <FileTextIcon className="size-5 text-primary" />,
        description: `本周已填写${stats.weeklyReportCount}天日报`,
      },
      {
        id: 2,
        name: "待生成周报",
        value: stats.pendingWeeklyReports.toString(),
        unit: "份",
        icon: <CalendarIcon className="size-5 text-success" />,
        description: `有${stats.pendingWeeklyReports}份周报待生成`,
      },
      {
        id: 3,
        name: "项目数量",
        value: stats.projectCount.toString(),
        unit: "个",
        icon: <FolderIcon className="size-5 text-warning" />,
        description: `当前共有${stats.projectCount}个项目`,
      },
      {
        id: 4,
        name: "本月工作量",
        value: (stats.monthlyWorkItemCount || 0).toString(),
        unit: "项",
        icon: <BarChart3Icon className="size-5 text-chart-4" />,
        description: `本月已完成${stats.monthlyWorkItemCount || 0}项`,
      },
    ];
  };

  // 处理日报选择，显示预览
  const handleReportSelect = (report: Report) => {
    setPreviewReport(report);
    setIsPreviewOpen(true);
  };

  // 关闭预览
  const closePreview = () => {
    setIsPreviewOpen(false);
    setPreviewReport(null);
  };

  // 最近 3 条日报
  const filteredReports = reports.slice(0, 3);

  // 检查是否为今天的日报
  const isToday = useCallback((dateString: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return dateString === today;
  }, []);


  if (loading || isLoading || !user) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <Spinner className="size-5" />
        <span className="text-muted-foreground">加载中...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">欢迎回来，{user.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="hidden md:inline">今天是 {new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          <span className="inline md:hidden">今天是 {new Date().toLocaleDateString('zh-CN', { weekday: 'short', month: 'numeric', day: 'numeric' })}</span>
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {generateStatsCards().map((stat) => (
          <Card key={stat.id}>
            <CardHeader>
              <CardDescription>{stat.name}</CardDescription>
              <CardTitle className="text-2xl font-semibold">
                {stat.value}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {stat.unit}
                </span>
              </CardTitle>
              <CardAction>{stat.icon}</CardAction>
            </CardHeader>
            <CardContent className="hidden text-xs text-muted-foreground md:block">
              {stat.description}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 最近日报 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>最近日报</CardTitle>
          <CardAction>
            <Button
              variant="link"
              size="sm"
              nativeButton={false}
              render={<Link to="/dashboard/daily-reports" />}
            >
              查看全部
            </Button>
          </CardAction>
        </CardHeader>

        {/* 内容区域 */}
        <CardContent>
          {filteredReports.length > 0 ? (
            filteredReports.map((report) => (
              <div
                key={report.id}
                className={`cursor-pointer p-3 hover:bg-muted md:p-4 lg:p-6 ${isToday(report.date) ? 'bg-accent' : ''}`}
                onClick={() => handleReportSelect(report)}
              >
                <div className="flex items-center justify-between">
                  <h3 className={`text-sm font-medium md:text-base ${isToday(report.date) ? 'text-primary' : ''}`}>
                    {format(parseISO(report.date), 'yyyy-MM-dd')}
                    {isToday(report.date) && (
                      <Badge variant="secondary" className="ml-2">
                        今日
                      </Badge>
                    )}
                  </h3>
                  <Badge variant="default">
                    {report.status}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-col gap-2 md:mt-3 md:gap-3">
                  {getReportProjects(report).map(project => (
                    <div key={project.id} className={`border-l-2 pl-2 md:pl-3 ${isToday(report.date) ? 'border-primary' : 'border-primary/30'}`}>
                      <div className="mb-0.5 text-xs font-medium text-primary md:mb-1 md:text-sm">
                        {project.name} ({project.code})
                      </div>
                      <ul className="flex list-disc flex-col gap-0.5 pl-4 marker:text-muted-foreground md:gap-1">
                        {getProjectWorkItems(report, project.id).map((item, idx) => (
                          <li key={idx} className="text-xs wrap-break-word text-muted-foreground md:text-sm">
                            {item.content}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>暂无日报记录</EmptyTitle>
                <EmptyDescription>
                  <Link to="/dashboard/daily-reports">去创建一个</Link>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
      
      {/* 日报预览弹窗 */}
      <Dialog open={isPreviewOpen && !!previewReport} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col sm:max-w-lg">
          {previewReport && (
          <>
          <DialogHeader>
            <DialogTitle>
              日报详情 - {previewReport.date}
            </DialogTitle>
            <DialogDescription>查看该日报的项目分组工作内容</DialogDescription>
          </DialogHeader>
            
            <div className="flex items-center mb-2 md:mb-4">
              <Badge variant="default">
                已提交
              </Badge>
            </div>
            
            <div className="min-h-0 grow overflow-auto">
              <div className="flex flex-col gap-3 md:gap-4">
                {getReportProjects(previewReport).map(project => (
                  <div key={project.id} className="border-l-2 border-primary/30 py-1 pl-2 md:py-2 md:pl-4">
                    <div className="mb-1 flex items-center md:mb-2">
                      <div className="text-sm font-medium text-primary">
                        {project.name}
                      </div>
                      <div className="ml-1 text-sm text-muted-foreground">
                        ({project.code})
                      </div>
                    </div>
                    <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-primary md:gap-2">
                      {getProjectWorkItems(previewReport, project.id).map((item, idx) => (
                        <li key={idx} className="text-xs wrap-break-word text-foreground md:text-sm">
                          {item.content}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            
            <DialogFooter className="mt-3 md:mt-4">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to={`/dashboard/daily-reports?edit=${previewReport.date}`} onClick={(e) => e.stopPropagation()} />}
              >
                <PencilIcon data-icon="inline-start" />
                编辑日报
              </Button>
              <Button size="sm" onClick={closePreview}>
                关闭
              </Button>
            </DialogFooter>
          </>
          )}
        </DialogContent>
      </Dialog>
      
    </div>
  );
}