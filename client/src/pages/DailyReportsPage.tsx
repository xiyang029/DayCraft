
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ChevronLeftIcon, ChevronRightIcon, TrashIcon, PencilIcon, CopyIcon, AlertCircleIcon, FileTextIcon } from "lucide-react";
import { useSearchParams } from 'react-router-dom';
import { useAuth } from "../contexts/auth-context";
import { apiDelete, apiGet } from "../lib/api";
import type { Project } from "../lib/db/types";
import { format, parseISO, startOfWeek, endOfWeek, eachDayOfInterval, getWeek, getMonth, getYear, isToday } from "date-fns";
import { zhCN } from "date-fns/locale";
import { toast } from "@/components/ui/toast";
import { usePersistentState } from "../lib/utils/page-persistence";
import { isAdjustedWorkday, isWorkdayCN } from "../lib/utils/workday";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import DailyReportDialog from "./DailyReportDialog";


interface ReportWithItems {
  id: string;
  date: string;
  day: string;
  status: string;
  items: ReportItemWithProject[];
}

interface ReportItemWithProject {
  id: string;
  content: string;
  project: Project;
}

interface ReportItemData {
  id: string;
  content: string;
  projects: Project | Project[];
}

// 新增日期项接口
interface DayItem {
  date: string;
  formattedDate: string;
  day: string;
  hasReport: boolean;
  report: ReportWithItems | null;
  isAdjusted?: boolean; // 是否为调休上班日（落在周末的工作日）
}

// 新增周数据接口
interface WeekData {
  weekNumber: number;
  year: number;
  startDate: Date;
  endDate: Date;
  formattedPeriod: string;
  days: DayItem[];
}

// 面包屑组件
interface BreadcrumbsProps {
  year: number;
  month: number;
  weekNumber: number;
  onWeekChange: (weekIndex: number) => void;
  currentWeekIndex: number;
  maxWeekIndex: number;
}

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ 
  year, 
  month, 
  weekNumber, 
  onWeekChange,
  currentWeekIndex,
  maxWeekIndex
}) => {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground md:gap-2 md:text-sm">
      <Tooltip>
<TooltipTrigger
        type="button"
        onClick={() => onWeekChange(currentWeekIndex + 1)}
        disabled={currentWeekIndex >= maxWeekIndex}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
        aria-label="上一周"
      >
        <ChevronLeftIcon data-icon="inline-start" />
      </TooltipTrigger>
<TooltipContent>上一周</TooltipContent>
</Tooltip>
      <span className="font-medium whitespace-nowrap text-foreground">{year}年{month}月<span className="hidden md:inline"> (第{weekNumber}周)</span></span>
      <Tooltip>
<TooltipTrigger
        type="button"
        onClick={() => onWeekChange(currentWeekIndex - 1)}
        disabled={currentWeekIndex <= 0}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
        aria-label="下一周"
      >
        <ChevronRightIcon data-icon="inline-start" />
      </TooltipTrigger>
<TooltipContent>下一周</TooltipContent>
</Tooltip>
    </div>
  );
};

export default function DailyReportsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [isDeletingReport, setIsDeletingReport] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // 新建/编辑日报弹窗（替代原 /daily-reports/new 独立页面）
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  
  // 使用持久化状态替代普通状态
  const [reports, setReports] = usePersistentState<ReportWithItems[]>('daily-reports-reports', []);
  const [projects, setProjects] = usePersistentState<Project[]>('daily-reports-projects', []);
  const [previewReport, setPreviewReport] = usePersistentState<ReportWithItems | null>('daily-reports-preview', null);
  const [weekData, setWeekData] = usePersistentState<WeekData[]>('daily-reports-week-data', []);
  const [currentWeekIndex, setCurrentWeekIndex] = usePersistentState<number>('daily-reports-current-week', 0);
  const [isPreviewOpen, setIsPreviewOpen] = usePersistentState<boolean>('daily-reports-preview-open', false);
  const [todayReportReminder, setTodayReportReminder] = usePersistentState<{
    date: string;
    hasReport: boolean;
  } | null>('daily-reports-today-reminder', null);
  
  // 添加数据加载状态引用
  const dataLoadedRef = useRef(false);
  const weekDataLoadedRef = useRef<Record<string, boolean>>({});
  // 添加最后数据加载时间戳
  const lastLoadTimeRef = useRef<number>(0);
  // 移除数据刷新间隔
  // 添加请求状态跟踪，避免重复请求
  const isRequestingRef = useRef<Record<string, boolean>>({});

  // 当前选中的周数据
  const currentWeekData = useMemo(() => {
    return weekData[currentWeekIndex] || null;
  }, [weekData, currentWeekIndex]);

  // 获取当前月份和年份
  const currentMonth = useMemo(() => {
    if (!currentWeekData) return new Date().getMonth() + 1;
    return getMonth(currentWeekData.startDate) + 1;
  }, [currentWeekData]);

  const currentYear = useMemo(() => {
    if (!currentWeekData) return new Date().getFullYear();
    return getYear(currentWeekData.startDate);
  }, [currentWeekData]);

  // 初始化周数据结构 - 使用useCallback
  const initWeekData = useCallback(() => {
    // 检查是否已经初始化过
    if (dataLoadedRef.current) {
      console.log('周数据已初始化，跳过');
      return;
    }
    
    console.log('初始化周数据结构');
    const today = new Date();
    const weeks: WeekData[] = [];
    
    // 生成最近12周的数据结构
    for (let i = 0; i < 12; i++) {
      const weekStartDate = startOfWeek(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * 7), { locale: zhCN });
      const weekEndDate = endOfWeek(weekStartDate, { locale: zhCN });
      const weekNumber = getWeek(weekStartDate, { locale: zhCN });
      const year = getYear(weekStartDate);
      
      // 获取这一周的所有日期（中国法定工作日：含调休上班的周末，不含法定节假日）
      const weekDates = eachDayOfInterval({ start: weekStartDate, end: weekEndDate }).filter((d) =>
        isWorkdayCN(d),
      );
      
      // 创建每天的初始数据
      const days: DayItem[] = weekDates.map(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const day = format(date, 'EEEE', { locale: zhCN });
        
        return {
          date: dateStr,
          formattedDate: format(date, 'yyyy-MM-dd'),
          day,
          hasReport: false,
          report: null,
          isAdjusted: isAdjustedWorkday(date)
        };
      });
      
      weeks.push({
        weekNumber,
        year,
        startDate: weekStartDate,
        endDate: weekEndDate,
        formattedPeriod: `${format(weekDates[0], 'yyyy-MM-dd')} 至 ${format(weekDates[weekDates.length - 1], 'yyyy-MM-dd')}`,
        days
      });
    }
    
    setWeekData(weeks);
    dataLoadedRef.current = true;
  }, [setWeekData]);

  // 检查今天的日报状态 - 使用useCallback
  const checkTodayReport = useCallback(async () => {
    if (!user) return;
    
    console.log('检查今日日报状态');
    try {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');

      // 查询今天的日报
      const data = await apiGet<{ reports: Array<{ id: string }> }>(`/api/daily-reports?date=${todayStr}`);
      const todayReport = data.reports[0] || null;

      // 设置今日日报提醒状态
      setTodayReportReminder({
        date: todayStr,
        hasReport: !!todayReport
      });

    } catch (error) {
      console.error('检查今日日报失败', error);
    }
  }, [user, setTodayReportReminder]);

  // 更新周数据中的日报信息 - 使用useCallback
  const updateWeekData = useCallback((week: WeekData, reports: ReportWithItems[]) => {
    setWeekData(prevWeeks => {
      const updatedWeeks = [...prevWeeks];
      const weekIndex = updatedWeeks.findIndex(w => 
        w.year === week.year && w.weekNumber === week.weekNumber
      );
      
      if (weekIndex !== -1) {
        const updatedDays = [...updatedWeeks[weekIndex].days];
        
        // 更新每一天的日报状态
        updatedDays.forEach((day, index) => {
          const report = reports.find(r => r.date === day.date);
          updatedDays[index] = {
            ...day,
            hasReport: !!report,
            report: report || null
          };
          
          // 如果是今天，更新今日日报提醒状态
          if (isToday(parseISO(day.date))) {
            setTodayReportReminder({
              date: day.date,
              hasReport: !!report
            });
          }
        });
        
        updatedWeeks[weekIndex] = {
          ...updatedWeeks[weekIndex],
          days: updatedDays
        };
      }
      
      return updatedWeeks;
    });
    
    // 更新全局reports状态，用于预览等功能
    setReports(reports);
  }, [setWeekData, setTodayReportReminder, setReports]);

  // 获取指定周的日报数据 - 使用useCallback
  const fetchWeekReports = useCallback(async (week: WeekData, forceUpdate: boolean = false) => {
    if (!user || !week) return;
    
    // 创建周的唯一标识符
    const weekKey = `${week.year}-${week.weekNumber}`;
    
    // 检查是否正在请求中，避免重复请求
    if (isRequestingRef.current[weekKey]) {
      console.log(`周 ${weekKey} 正在请求中，跳过重复请求`);
      return;
    }
    
    // 检查该周的数据是否已经加载过，如果强制更新则忽略此检查
    if (!forceUpdate && weekDataLoadedRef.current[weekKey]) {
      console.log(`周 ${weekKey} 的数据已加载，跳过重新获取`);
      setIsLoading(false);
      return;
    }
    
    // 检查是否超过刷新间隔，如果强制更新则忽略此检查
    const now = Date.now();
    const timeSinceLastLoad = now - lastLoadTimeRef.current;
    if (!forceUpdate && lastLoadTimeRef.current > 0 && timeSinceLastLoad < 0) { // 移除数据刷新间隔
      console.log(`数据加载间隔小于0秒，跳过重新获取`);
      setIsLoading(false);
      return;
    }
    
    console.log(`加载周 ${weekKey} 的日报数据${forceUpdate ? '(强制刷新)' : ''}`);
    
    // 设置请求状态
    isRequestingRef.current[weekKey] = true;
    setIsLoading(true);
    try {
      // 获取项目数据（只需获取一次）
      if (projects.length === 0) {
        const projectsRes = await apiGet<{ projects: Project[] }>('/api/projects');

        setProjects(projectsRes.projects || []);
      }

      // 获取该周日期范围内的日报数据（含明细，一次请求）
      const startDateStr = format(week.startDate, 'yyyy-MM-dd');
      const endDateStr = format(week.endDate, 'yyyy-MM-dd');

      const reportsRes = await apiGet<{ reports: any[] }>(
        `/api/daily-reports?start=${startDateStr}&end=${endDateStr}&with_items=1`
      );

      const reportsWithItems: ReportWithItems[] = [];

      // 格式化每个日报及其工作项
      for (const report of reportsRes.reports || []) {
        // 格式化日期和星期
        const reportDate = parseISO(report.date);
        const day = format(reportDate, 'EEEE', { locale: zhCN });
        const formattedDate = format(reportDate, 'yyyy-MM-dd');

        const items = ((report.report_items || []) as unknown as ReportItemData[]).map(item => {
          // 确保projects是单个Project对象而不是数组
          const project = Array.isArray(item.projects) ? item.projects[0] : item.projects;
          return {
            id: item.id as string,
            content: item.content as string,
            project: project as Project
          };
        });

        reportsWithItems.push({
          id: report.id,
          date: formattedDate,
          day,
          status: '已提交', // 日报状态，目前只有一种状态
          items,
        });
      }
      
      // 更新当前周的日报数据
      updateWeekData(week, reportsWithItems);
      
      // 标记该周数据已加载
      weekDataLoadedRef.current[weekKey] = true;
      lastLoadTimeRef.current = now;
      
    } catch (error) {
      console.error('加载数据失败', error);
      toast.add({ title: '加载数据失败', type: 'error' });
    } finally {
      // 清除请求状态
      isRequestingRef.current[weekKey] = false;
      setIsLoading(false);
    }
  }, [user, setProjects, updateWeekData]);

  // 打开新建/编辑日报弹窗
  const openReportDialog = (date: string) => {
    setDialogDate(date);
    setDialogOpen(true);
  };

  // 弹窗保存成功后刷新列表
  const handleDialogSaved = useCallback(() => {
    if (currentWeekData) {
      const weekKey = `${currentWeekData.year}-${currentWeekData.weekNumber}`;
      weekDataLoadedRef.current[weekKey] = false;
      fetchWeekReports(currentWeekData, true);
    }
    checkTodayReport();
  }, [currentWeekData, fetchWeekReports, checkTodayReport]);

  // 加载项目和日报数据
  useEffect(() => {
    if (!user) return;

    // 初始化周数据结构
    initWeekData();

    // 检查今天的日报状态
    checkTodayReport();
  }, [user]);

  // 深链直达：/dashboard/daily-reports?edit=yyyy-MM-dd 直接打开编辑弹窗
  useEffect(() => {
    const edit = searchParams.get('edit');
    if (edit && /^\d{4}-\d{2}-\d{2}$/.test(edit)) {
      setDialogDate(edit);
      setDialogOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 仅在首次加载和没有强制刷新的情况下加载该周的日报数据
  const isFirstLoadRef = useRef<Record<number, boolean>>({});

  // 当周索引变化时，加载该周的日报数据（避免与强制刷新冲突）
  useEffect(() => {
    if (user && weekData.length > 0) {
      // 如果是首次加载该周的数据，正常获取
      if (!isFirstLoadRef.current[currentWeekIndex]) {
        isFirstLoadRef.current[currentWeekIndex] = true;
        fetchWeekReports(weekData[currentWeekIndex]);
      }
    }
  }, [user, currentWeekIndex, weekData.length]);

  // 在页面可见性变化时的处理逻辑
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
          console.log('日报页面恢复可见');
          
          // 检查今日日报状态 - 这个功能保留，因为它很重要
        checkTodayReport();
          
          // 不再自动刷新数据
          console.log('保持现有数据，不自动刷新');
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [user, checkTodayReport]);

  // 处理周切换
  const handleWeekChange = (weekIndex: number) => {
    if (weekIndex >= 0 && weekIndex < weekData.length) {
      setCurrentWeekIndex(weekIndex);
      
      // 在周切换后强制刷新数据
      if (user && weekData[weekIndex]) {
        // 延迟一点执行，确保状态已更新
        setTimeout(() => {
          fetchWeekReports(weekData[weekIndex], true);
        }, 10);
      }
    }
  };



  // 显示删除确认对话框
  const handleDeleteClick = (e: React.MouseEvent, reportId: string) => {
    e.stopPropagation();
    setReportToDelete(reportId);
    setConfirmDeleteOpen(true);
  };

  // 取消删除操作
  const handleCancelDelete = () => {
    setReportToDelete(null);
    setConfirmDeleteOpen(false);
  };

  // 确认删除日报
  const handleConfirmDelete = async () => {
    if (!reportToDelete) return;

    setIsDeletingReport(true);
    try {
      console.log(`正在删除日报 ID: ${reportToDelete}`);

      await apiDelete(`/api/daily-reports/${reportToDelete}`);

      // 从状态中移除被删除的日报
      setReports(prev => prev.filter(report => report.id !== reportToDelete));
      toast.add({ title: '日报删除成功', type: 'success' });
      
      // 立即刷新当前周的数据，确保UI显示正确
      if (currentWeekData) {
        // 重置该周的加载状态，确保重新获取数据
        const weekKey = `${currentWeekData.year}-${currentWeekData.weekNumber}`;
        weekDataLoadedRef.current[weekKey] = false;
        
        // 强制刷新数据
        fetchWeekReports(currentWeekData, true);
      }
      
    } catch (error) {
      console.error('删除日报时出错', error);
      toast.add({ title: `删除日报失败: ${error instanceof Error ? error.message : '未知错误'}`, type: 'error' });
    } finally {
      setIsDeletingReport(false);
      setReportToDelete(null);
      setConfirmDeleteOpen(false);
    }
  };

  // 编辑日报（打开弹窗；若预览弹窗开着则先关闭）
  const handleEditClick = (e: React.MouseEvent, date: string) => {
    e.stopPropagation();
    closePreview();
    openReportDialog(date);
  };

  // 复制日报内容为YAML格式
  const handleCopyReport = (e: React.MouseEvent, report: ReportWithItems) => {
    e.stopPropagation();
    
    // 获取报告中涉及的所有项目
    const reportProjects = getReportProjects(report);
    
    let yamlContent = '';
    
    // 按项目组织工作内容
    reportProjects.forEach(project => {
      yamlContent += `${project.name}:\n`;
      
      // 获取该项目下的所有工作项
      const projectItems = getProjectItems(report, project.id);
      projectItems.forEach(item => {
        yamlContent += `  - ${item.content}\n`;
      });
      
      // 移除项目之间的换行
    });
    
    try {
      // 使用异步函数进行复制
      if (navigator.clipboard && window.isSecureContext) {
        // 安全上下文中使用标准 Clipboard API
        navigator.clipboard.writeText(yamlContent)
          .then(() => {
            toast.add({ title: '日报内容已复制到剪贴板', type: 'success' });
          })
          .catch(err => {
            console.error('复制失败:', err);
            fallbackCopyTextToClipboard(yamlContent);
          });
      } else {
        // 回退方法，适用于非安全上下文
        fallbackCopyTextToClipboard(yamlContent);
      }
    } catch (err) {
      console.error('复制失败:', err);
      toast.add({ title: '复制失败，请重试', type: 'error' });
    }
  };

  // 回退复制方法
  const fallbackCopyTextToClipboard = (text: string) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      
      // 避免滚动到底部
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          toast.add({ title: '日报内容已复制到剪贴板', type: 'success' });
        } else {
          toast.add({ title: '复制失败，请重试', type: 'error' });
        }
      } catch (err) {
        console.error('复制命令执行失败:', err);
        toast.add({ title: '复制失败，请重试', type: 'error' });
      }
      
      document.body.removeChild(textArea);
    } catch (err) {
      console.error('回退复制方法失败:', err);
      toast.add({ title: '复制失败，请重试', type: 'error' });
    }
  };

  // 获取特定项目下的工作项
  const getProjectItems = (report: ReportWithItems, projectId: string) => {
    return report.items.filter(item => item.project.id === projectId);
  };

  // 获取报告中涉及的所有项目
  const getReportProjects = (report: ReportWithItems) => {
    const projectMap = new Map<string, Project>();
    
    report.items.forEach(item => {
      if (item.project && !projectMap.has(item.project.id)) {
        projectMap.set(item.project.id, item.project);
      }
    });
    
    return Array.from(projectMap.values());
  };

  // 项目工作条目渲染：日报列表紧凑版与预览详情版共用（detail 为 true 时输出预览的完整条目列表）
  const renderProjectWork = (report: ReportWithItems, project: Project, detail = false) => {
    if (detail) {
      return (
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
            {getProjectItems(report, project.id).map((item, idx) => (
              <li key={idx} className="text-xs break-words text-foreground md:text-sm">
                {item.content}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    return (
      <div key={project.id} className="border-l-2 border-primary/30 py-0.5 pl-2">
        <div className="mb-0.5 flex items-center">
          <div className="text-sm font-medium text-primary">
            {project.name}
          </div>
          <div className="ml-1 text-sm text-muted-foreground">
            ({project.code})
          </div>
        </div>
        <div className="line-clamp-1 text-sm text-muted-foreground">
          {getProjectItems(report, project.id)
            .map(item => item.content)
            .join('；')}
        </div>
      </div>
    );
  };

  // 处理日报选择，显示预览
  const handleReportSelect = (reportId: string) => {
    const report = reports.find(r => r.id === reportId);
    if (report) {
      setPreviewReport(report);
      setIsPreviewOpen(true);
    }
  };

  // 关闭预览
  const closePreview = () => {
    setIsPreviewOpen(false);
    setPreviewReport(null);
  };

  // 在预览中复制日报内容
  const handlePreviewCopy = () => {
    if (!previewReport) return;
    
    // 获取报告中涉及的所有项目
    const reportProjects = getReportProjects(previewReport);
    
    let yamlContent = '';
    
    // 按项目组织工作内容
    reportProjects.forEach(project => {
      yamlContent += `${project.name}:\n`;
      
      // 获取该项目下的所有工作项
      const projectItems = getProjectItems(previewReport, project.id);
      projectItems.forEach(item => {
        yamlContent += `  - ${item.content}\n`;
      });
      
      // 移除项目之间的换行
    });
    
    try {
      // 使用异步函数进行复制
      if (navigator.clipboard && window.isSecureContext) {
        // 安全上下文中使用标准 Clipboard API
        navigator.clipboard.writeText(yamlContent)
          .then(() => {
            toast.add({ title: '日报内容已复制到剪贴板', type: 'success' });
          })
          .catch(err => {
            console.error('复制失败:', err);
            fallbackCopyTextToClipboard(yamlContent);
          });
      } else {
        // 回退方法，适用于非安全上下文
        fallbackCopyTextToClipboard(yamlContent);
      }
    } catch (err) {
      console.error('复制失败:', err);
      toast.add({ title: '复制失败，请重试', type: 'error' });
    }
  };




  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">日报管理</h1>

      {/* 今日日报提醒 */}
      {todayReportReminder && !todayReportReminder.hasReport && (
        <Alert>
          <AlertCircleIcon data-icon="inline-start" />
          <AlertDescription>
            您今天还没有填写日报，
            <Button
              variant="link"
              size="sm"
              className="h-auto px-1 font-medium text-primary"
              onClick={() => openReportDialog(todayReportReminder.date)}
            >
              立即填写
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 日报列表 */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle>日报列表</CardTitle>
            {currentWeekData && (
              <Breadcrumbs
                year={currentYear}
                month={currentMonth}
                weekNumber={currentWeekData.weekNumber}
                onWeekChange={handleWeekChange}
                currentWeekIndex={currentWeekIndex}
                maxWeekIndex={weekData.length - 1}
              />
            )}
          </div>
        </CardHeader>

        <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 md:p-12">
            <Spinner className="size-5" />
            <span className="text-sm text-muted-foreground md:text-base">加载中...</span>
          </div>
        ) : weekData.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>暂无日报数据</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
                {currentWeekData && currentWeekData.days.map((day) => {
                  const isCurrentDay = isToday(parseISO(day.date));
                  return (
                  <li 
                      key={day.date} 
                      className={cn('border-l-2 border-transparent p-3 md:p-4', day.hasReport && 'cursor-pointer', isCurrentDay && 'border-primary bg-accent')}
                      onClick={() => day.hasReport && day.report && handleReportSelect(day.report.id)}
                    >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                      <div className="flex items-start grow">
                        <div className="shrink-0">
                          <FileTextIcon className={cn('size-5 md:size-6', day.hasReport ? 'text-primary' : 'text-muted-foreground')} />
                        </div>
                        <div className="ml-3 md:ml-4 grow">
                          <div className="flex items-center justify-between w-full">
                            <div className="flex flex-wrap items-center gap-1 md:gap-2">
                              <h3 className={cn('text-sm md:text-base font-medium', isCurrentDay ? 'font-semibold text-primary' : 'text-foreground')}>
                                {format(parseISO(day.date), 'MM-dd')} <span className="hidden md:inline">({day.day})</span>
                              </h3>
                              {isCurrentDay && (
                                <Badge variant="secondary">
                                今天
                              </Badge>
                            )}
                              {day.isAdjusted && (
                                <Badge variant="secondary">
                                调休上班
                              </Badge>
                            )}
                              {day.hasReport ? (
                                <Badge variant="default">
                                  已提交
                                </Badge>
                              ) : (
                                <Badge variant="secondary">
                            {isCurrentDay ? '今日待填' : '未提交'}
                          </Badge>
                        )}
                            </div>
                            <div className="flex items-center gap-1 md:gap-2">
                          <Button variant="outline" size="sm"
                            onClick={(e) => { e.stopPropagation(); openReportDialog(day.date); }}
                            className={isCurrentDay ? 'border-primary/30 text-primary' : undefined}
                            title={day.hasReport ? "编辑日报" : "创建日报"}
                          >
                              <PencilIcon data-icon="inline-start" />
                              {day.hasReport ? "编辑" : "填写"}
                          </Button>
                          {day.hasReport && day.report && (
                            <>
                              <Button variant="outline" size="sm"
                                onClick={(e) => handleCopyReport(e, day.report!)}
                                title="复制日报"
                              >
                                  <CopyIcon data-icon="inline-start" />
                                  <span className="hidden md:inline">复制</span>
                              </Button>
                              <Button variant="destructive" size="sm"
                                onClick={(e) => handleDeleteClick(e, day.report!.id)}
                                title="删除日报"
                              >
                                  <TrashIcon data-icon="inline-start" />
                                  <span className="hidden md:inline">删除</span>
                              </Button>
                            </>
                          )}
                        </div>
                          </div>
                          
                          <div className="mt-0.5 text-xs text-muted-foreground md:mt-1 md:text-sm">
                            <span>{format(parseISO(day.date), 'yyyy年MM月dd日')}</span>
                          </div>
                          
                          {day.hasReport && day.report && (
                            <div className="flex flex-col mt-1 md:mt-2 gap-2">
                              {getReportProjects(day.report).map(project => {
                                // 使用非空断言确保TypeScript知道day.report不为null
                                const report = day.report!;
                                
                                return renderProjectWork(report, project);
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                  );
                })}
          </ul>
        )}
        </CardContent>
      </Card>

      {/* 日报预览弹窗 */}
      <Dialog open={isPreviewOpen} onOpenChange={(open) => { if (!open) closePreview(); }}>
        {previewReport && (
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate pr-2">
              日报详情 - {previewReport.date} <span className="hidden md:inline">({previewReport.day})</span>
            </DialogTitle>
            <DialogDescription>查看日报的项目分组工作内容</DialogDescription>
          </DialogHeader>
            
            <div className="flex items-center">
              <Badge variant="default">
                已提交
              </Badge>
            </div>
            
            <div className="min-h-0 grow overflow-auto">
              <div className="flex flex-col gap-3 md:gap-4">
                {getReportProjects(previewReport).map(project =>
                  renderProjectWork(previewReport, project, true)
                )}
              </div>
            </div>
            
            <DialogFooter className="gap-1 md:gap-3">
              <Button variant="outline" size="sm"
                onClick={handlePreviewCopy}
              >
                <CopyIcon data-icon="inline-start" />
                复制内容
              </Button>
              <Button variant="outline" size="sm"
                onClick={(e) => handleEditClick(e, previewReport.date)}
                className="border-primary/30 text-primary"
              >
                <PencilIcon data-icon="inline-start" />
                编辑日报
              </Button>
              <Button size="sm"
                onClick={closePreview}
              >
                关闭
              </Button>
            </DialogFooter>
        </DialogContent>
        )}
      </Dialog>

      {/* 新建/编辑日报弹窗（替代原独立页面） */}
      <DailyReportDialog
        open={dialogOpen}
        date={dialogDate}
        onOpenChange={setDialogOpen}
        onSaved={handleDialogSaved}
      />

      {/* 删除确认对话框 */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={(open) => { if (!open) handleCancelDelete(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除这份日报吗？此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete} disabled={isDeletingReport}>
              取消
            </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={isDeletingReport}
              >
                {isDeletingReport ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    删除中...
                  </>
                ) : (
                  "确认删除"
                )}
              </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
} 