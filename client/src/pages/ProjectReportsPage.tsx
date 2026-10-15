
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon, TrashIcon, PencilIcon, FileTextIcon, AlertCircleIcon, CalendarIcon, EyeIcon, EyeOffIcon, CopyIcon, XIcon } from "lucide-react";
import { Link } from 'react-router-dom';
import { useAuth } from "../contexts/auth-context";
import { apiDelete, apiGet } from "../lib/api";
import type { Project } from "../lib/db/types";
import { format, parseISO, getYear, addWeeks, subWeeks, startOfISOWeek, endOfISOWeek, getISOWeek } from "date-fns";
import { zhCN } from "date-fns/locale";
import { toast } from "@/components/ui/toast";
import { useNavigate } from 'react-router-dom';
import { usePersistentState } from "../lib/utils/page-persistence";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";




interface ProjectWeeklyReportData {
  id: string;
  year: number;
  week_number: number;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

interface ProjectWeeklyReportItemData {
  id: string;
  content: string;
  projects?: Project; // 改为可选，因为项目可能已被删除
  work_breakdown_items?: {
    id: string;
    name: string;
    level?: number;
    parent_id?: string;
  };
  // 快照字段，用于保留历史记录
  project_name?: string;
  project_code?: string;
  work_item_name?: string;
  work_item_path?: string;
}

interface WorkItemHierarchy {
  id: string;
  name: string;
  level: number;
  parent_id?: string;
  children: WorkItemHierarchy[];
  items: ProjectWeeklyReportItemData[];
  fullPath: string; // 完整层级路径，如 "一级工作项 > 二级工作项 > 三级工作项"
}

interface GroupedProjectData {
  project: Project;
  items: ProjectWeeklyReportItemData[];
  workItems: {
    [workItemId: string]: {
      workItem: {
        id: string;
        name: string;
        level?: number;
        parent_id?: string;
      };
      items: ProjectWeeklyReportItemData[];
      mergedContent: string;
    };
  };
  directItems: ProjectWeeklyReportItemData[]; // 直接在项目下的工作项
  workItemsHierarchy: WorkItemHierarchy[]; // 工作项层级结构
}

interface WeekReportWithItems {
  id: string;
  year: number;
  week_number: number;
  start_date: string;
  end_date: string;
  formattedPeriod: string;
  hasReport: boolean;
  items: ProjectWeeklyReportItemData[];
}

interface WeekData {
  year: number;
  week_number: number;
  start_date: Date;
  end_date: Date;
  formattedPeriod: string;
  report: WeekReportWithItems | null;
}

// 周/年导航图标按钮：Base UI Trigger 的 render 目标必须是原生元素（button + buttonVariants）
function IconTooltipButton({
  onClick,
  label,
  tooltip,
  size = "icon",
  children,
}: {
  onClick: () => void;
  label: string;
  tooltip: string;
  size?: "icon" | "icon-sm";
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={cn(buttonVariants({ variant: "ghost", size }))}
          >
            {children}
          </button>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export default function ProjectReportsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // 状态管理 - 使用持久化状态
  const [currentWeek, setCurrentWeek] = usePersistentState('project-reports-current-week', new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [reports, setReports] = usePersistentState<ProjectWeeklyReportData[]>('project-reports-reports', []);
  const [reportItems, setReportItems] = usePersistentState<{ [reportId: string]: ProjectWeeklyReportItemData[] }>('project-reports-items', {});
  const [allWorkItems, setAllWorkItems] = useState<{ [projectId: string]: any[] }>({});

  // 辅助函数：获取项目显示信息，优先使用快照字段
  const getProjectDisplayInfo = useCallback((item: ProjectWeeklyReportItemData) => {
    // 优先使用快照字段
    if (item.project_name) {
      return {
        name: item.project_name,
        code: item.project_code || '',
        isDeleted: !item.projects // 如果没有关联的项目对象，说明项目已被删除
      };
    }
    // 如果没有快照字段，使用关联的项目信息
    if (item.projects) {
      return {
        name: item.projects.name,
        code: item.projects.code,
        isDeleted: false
      };
    }
    // 都没有的话，返回默认值
    return {
      name: '未知项目',
      code: '',
      isDeleted: true
    };
  }, []);

  // 辅助函数：获取工作项显示信息，优先使用快照字段
  const getWorkItemDisplayInfo = useCallback((item: ProjectWeeklyReportItemData) => {
    // 优先使用快照字段
    if (item.work_item_name) {
      return {
        name: item.work_item_name,
        path: item.work_item_path || item.work_item_name,
        isDeleted: !item.work_breakdown_items // 如果没有关联的工作项对象，说明工作项已被删除
      };
    }
    // 如果没有快照字段，使用关联的工作项信息
    if (item.work_breakdown_items) {
      return {
        name: item.work_breakdown_items.name,
        path: item.work_breakdown_items.name, // 这里可以后续优化为完整路径
        isDeleted: false
      };
    }
    // 都没有的话，返回null（表示没有工作项）
    return null;
  }, []);

  // 添加数据加载状态引用
  const dataLoadedRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);
  const isRequestingRef = useRef(false);

  // 显示控制状态
  const [showWorkItems, setShowWorkItems] = usePersistentState('project-reports-show-work-items', true);
  const [showHierarchy, setShowHierarchy] = usePersistentState('project-reports-show-hierarchy', false);

  // 删除确认状态
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [isDeletingReport, setIsDeletingReport] = useState(false);

  // 年度数据状态
  const [currentYear, setCurrentYear] = usePersistentState('project-reports-current-year', new Date().getFullYear());
  const [yearlyData, setYearlyData] = useState<{ [week: number]: { hasReport: boolean } }>({});

  // 项目筛选状态
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = usePersistentState('project-reports-selected-project', '');

  // 计算当前周的数据
  const currentWeekData = useMemo(() => {
    const weekStart = startOfISOWeek(currentWeek);
    const weekEnd = endOfISOWeek(currentWeek);
    const year = getYear(weekStart);
    const weekNumber = getISOWeek(weekStart);
    
    const report = reports.find(r => r.year === year && r.week_number === weekNumber);
    const items = report ? reportItems[report.id] || [] : [];
    
    return {
      year,
      week_number: weekNumber,
      start_date: weekStart,
      end_date: weekEnd,
      formattedPeriod: `${format(weekStart, 'M月d日', { locale: zhCN })} - ${format(weekEnd, 'M月d日', { locale: zhCN })}`,
      report: report ? {
        id: report.id,
        year: report.year,
        week_number: report.week_number,
        start_date: report.start_date,
        end_date: report.end_date,
        formattedPeriod: `${format(parseISO(report.start_date), 'M月d日', { locale: zhCN })} - ${format(parseISO(report.end_date), 'M月d日', { locale: zhCN })}`,
        hasReport: true,
        items
      } : null
    };
  }, [currentWeek, reports, reportItems]);

  // 今日周报提醒
  const todayWeekReportReminder = useMemo(() => {
    const today = new Date();
    const todayWeekStart = startOfISOWeek(today);
    const todayYear = getYear(todayWeekStart);
    const todayWeekNumber = getISOWeek(todayWeekStart);
    
    const hasReport = reports.some(r => r.year === todayYear && r.week_number === todayWeekNumber);
    
    return {
      year: todayYear,
      week_number: todayWeekNumber,
      hasReport,
      date: format(todayWeekStart, 'yyyy-MM-dd')
    };
  }, [reports]);

  // 构建工作项层级结构 - 只包含有工作内容的工作项
  const buildWorkItemHierarchy = useCallback((projectId: string, reportItems: ProjectWeeklyReportItemData[]): WorkItemHierarchy[] => {
    const projectWorkItems = allWorkItems[projectId] || [];
    if (projectWorkItems.length === 0) return [];

    // 创建工作项映射
    const workItemMap: { [id: string]: any } = {};
    projectWorkItems.forEach(item => {
      workItemMap[item.id] = item;
    });

    // 构建层级路径函数
    const buildPath = (workItemId: string): string => {
      const item = workItemMap[workItemId];
      if (!item) return '';

      if (item.parent_id && workItemMap[item.parent_id]) {
        const parentPath = buildPath(item.parent_id);
        return parentPath ? `${parentPath} > ${item.name}` : item.name;
      }
      return item.name;
    };

    // 获取所有有工作内容的工作项ID
    const workItemsWithContent = new Set(
      reportItems
        .filter(item => item.work_breakdown_items?.id)
        .map(item => item.work_breakdown_items!.id)
    );

    // 只构建有工作内容的工作项的层级结构
    const hierarchyItems: WorkItemHierarchy[] = [];

    workItemsWithContent.forEach(workItemId => {
      const workItem = workItemMap[workItemId];
      if (!workItem) return;

      const workItemItems = reportItems.filter(item =>
        item.work_breakdown_items?.id === workItemId
      );

      hierarchyItems.push({
        id: workItem.id,
        name: workItem.name,
        level: workItem.level,
        parent_id: workItem.parent_id,
        children: [], // 不需要子层级，直接平铺显示
        items: workItemItems,
        fullPath: buildPath(workItemId)
      });
    });

    // 按层级和位置排序
    return hierarchyItems.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return a.fullPath.localeCompare(b.fullPath);
    });
  }, [allWorkItems]);

  // 按项目分组数据
  const groupedProjectData = useMemo(() => {
    if (!currentWeekData.report) return [];

    const grouped: { [projectKey: string]: GroupedProjectData } = {};

    currentWeekData.report.items.forEach(item => {
      const projectInfo = getProjectDisplayInfo(item);
      // 使用项目名称作为分组键，因为项目可能已被删除
      const projectKey = item.projects?.id || `deleted_${projectInfo.name}_${projectInfo.code}`;

      if (!grouped[projectKey]) {
        // 创建项目对象，优先使用实际项目信息，否则使用快照信息
        const project: Project = item.projects || {
          id: projectKey,
          name: projectInfo.name,
          code: projectInfo.code,
          description: null,
          user_id: '',
          created_at: '',
          updated_at: '',
          is_active: false
        };

        grouped[projectKey] = {
          project,
          items: [],
          workItems: {},
          directItems: [],
          workItemsHierarchy: []
        };
      }

      grouped[projectKey].items.push(item);

      // 处理工作项信息
      const workItemInfo = getWorkItemDisplayInfo(item);
      if (workItemInfo) {
        const workItemId = item.work_breakdown_items?.id || `deleted_${workItemInfo.name}`;
        if (!grouped[projectKey].workItems[workItemId]) {
          // 创建工作项对象，优先使用实际工作项信息，否则使用快照信息
          const workItem = item.work_breakdown_items || {
            id: workItemId,
            name: workItemInfo.name,
            level: 0,
            parent_id: undefined
          };

          grouped[projectKey].workItems[workItemId] = {
            workItem,
            items: [],
            mergedContent: ''
          };
        }
        grouped[projectKey].workItems[workItemId].items.push(item);
      } else {
        grouped[projectKey].directItems.push(item);
      }
    });

    // 为每个项目构建工作项层级结构并合并相同工作项的内容
    Object.keys(grouped).forEach(projectId => {
      // 合并相同工作项的内容
      Object.values(grouped[projectId].workItems).forEach(workItemData => {
        const contents = workItemData.items.map(item => item.content.trim()).filter(content => content);
        workItemData.mergedContent = contents.join('\n');
      });

      grouped[projectId].workItemsHierarchy = buildWorkItemHierarchy(projectId, grouped[projectId].items);
    });

    // 应用项目筛选
    let result = Object.values(grouped);
    if (selectedProjectId) {
      result = result.filter(projectData => projectData.project.id === selectedProjectId);
    }

    return result;
  }, [currentWeekData.report, buildWorkItemHierarchy, selectedProjectId]);





  // 加载项目周报数据
  const fetchProjectReports = useCallback(async (forceUpdate: boolean = false) => {
    if (!user) return;

    // 检查是否正在请求中，避免重复请求
    if (isRequestingRef.current) {
      console.log('项目周报正在请求中，跳过重复请求');
      return;
    }

    // 检查数据是否已经加载过，如果强制更新则忽略此检查
    if (!forceUpdate && dataLoadedRef.current && reports.length > 0) {
      console.log('项目周报数据已加载，跳过重新获取');
      return;
    }

    console.log(`加载项目周报数据${forceUpdate ? '(强制刷新)' : ''}`);

    // 设置请求状态
    isRequestingRef.current = true;
    setIsLoading(true);
    try {
      // 获取项目周报主表 + 明细（一次请求）
      const data = await apiGet<{ reports: any[] }>('/api/project-weekly-reports?with_items=1');
      const reportsData = data.reports || [];

      setReports((reportsData as unknown as ProjectWeeklyReportData[]) || []);

      // 按报告ID分组条目数据
      const itemsByReport: { [reportId: string]: ProjectWeeklyReportItemData[] } = {};
      const allItems: any[] = [];
      reportsData.forEach((report: any) => {
        const items = report.items || [];
        itemsByReport[report.id] = items as ProjectWeeklyReportItemData[];
        allItems.push(...items);
      });

      setReportItems(itemsByReport);

      if (allItems.length > 0) {
        // 获取所有相关项目的工作项数据，用于构建层级结构
        const projectIds = Array.from(new Set(
          allItems.map((item: any) => item.projects?.id).filter(Boolean) || []
        ));
        if (projectIds.length > 0) {
          const workItemsByProject: { [projectId: string]: any[] } = {};
          await Promise.all(projectIds.map(async (pid) => {
            try {
              const res = await apiGet<{ items: any[] }>(
                `/api/work-breakdown/items?project_id=${encodeURIComponent(pid as string)}`
              );
              workItemsByProject[pid as string] = res.items || [];
            } catch (e) {
              console.error('获取工作项失败', e);
            }
          }));
          setAllWorkItems(workItemsByProject);
        }
      }

      // 标记数据已加载
      dataLoadedRef.current = true;
      lastLoadTimeRef.current = Date.now();

    } catch (error) {
      console.error('获取项目周报失败', error);
      toast.add({ title: '获取项目周报失败', type: 'error' });
    } finally {
      // 清除请求状态
      isRequestingRef.current = false;
      setIsLoading(false);
    }
  }, [user, setReports, setReportItems]);

  // 加载项目数据
  const fetchProjects = useCallback(async () => {
    if (!user) return;

    try {
      const data = await apiGet<{ projects: Project[] }>('/api/projects?active_only=true');

      setProjects(data.projects || []);
    } catch (error) {
      console.error('获取项目失败', error);
      toast.add({ title: '获取项目失败', type: 'error' });
    }
  }, [user]);

  // 生成年度数据
  const generateYearlyData = useCallback(() => {
    const yearData: { [week: number]: { hasReport: boolean } } = {};

    // 初始化所有周数据
    for (let week = 1; week <= 53; week++) {
      yearData[week] = { hasReport: false };
    }

    // 获取当前年份的所有周报
    const currentYearReports = reports.filter(report => report.year === currentYear);

    // 标记有周报的周数
    currentYearReports.forEach(report => {
      yearData[report.week_number] = {
        hasReport: true
      };
    });

    setYearlyData(yearData);
  }, [reports, currentYear]);

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

  // 确认删除项目周报
  const handleConfirmDelete = async () => {
    if (!reportToDelete) return;

    setIsDeletingReport(true);
    try {
      await apiDelete(`/api/project-weekly-reports/${reportToDelete}`);

      toast.add({ title: '项目周报删除成功', type: 'success' });
      // 强制刷新数据
      fetchProjectReports(true);
    } catch (error) {
      console.error('删除项目周报失败', error);
      toast.add({ title: '删除项目周报失败', type: 'error' });
    } finally {
      setIsDeletingReport(false);
      setReportToDelete(null);
      setConfirmDeleteOpen(false);
    }
  };

  // 复制项目周报为Markdown格式
  const handleCopyMarkdown = (reportData: GroupedProjectData[]) => {
    let markdownContent = '';

    reportData.forEach(projectData => {
      markdownContent += `## ${projectData.project.name}\n\n`;

      let itemCounter = 1; // 全局序号计数器

      // 按工作项分组的工作
      if (showWorkItems && Object.keys(projectData.workItems).length > 0) {
        if (showHierarchy) {
          // 层级模式：显示完整层级路径
          projectData.workItemsHierarchy.forEach(hierarchyItem => {
            markdownContent += `### ${hierarchyItem.fullPath}\n`;
            const mergedContent = projectData.workItems[hierarchyItem.id]?.mergedContent ||
                                 hierarchyItem.items.map(item => item.content).join('\n');
            let workItemCounter = 1; // 每个工作项下的序号从1开始
            mergedContent.split('\n').forEach(line => {
              if (line.trim()) {
                markdownContent += `${workItemCounter}. ${line.trim()}\n`;
                workItemCounter++;
              }
            });
            markdownContent += '\n';
          });
        } else {
          // 简单模式：显示工作项名称
          Object.values(projectData.workItems).forEach(workItemData => {
            markdownContent += `### ${workItemData.workItem.name}\n`;
            let workItemCounter = 1; // 每个工作项下的序号从1开始
            workItemData.mergedContent.split('\n').forEach(line => {
              if (line.trim()) {
                markdownContent += `${workItemCounter}. ${line.trim()}\n`;
                workItemCounter++;
              }
            });
            markdownContent += '\n';
          });
        }
      } else if (!showWorkItems && Object.keys(projectData.workItems).length > 0) {
        // 隐藏工作项时：不显示工作项分组，直接列出内容
        let hiddenItemCounter = 1; // 隐藏工作项时的序号从1开始
        Object.values(projectData.workItems).forEach(workItemData => {
          workItemData.mergedContent.split('\n').forEach(line => {
            if (line.trim()) {
              markdownContent += `${hiddenItemCounter}. ${line.trim()}\n`;
              hiddenItemCounter++;
            }
          });
        });
        // 其他工作（未选择工作项的内容）
        projectData.directItems.forEach(item => {
          markdownContent += `${hiddenItemCounter}. ${item.content}\n`;
          hiddenItemCounter++;
        });
        markdownContent += '\n';
      } else {
        // 只有其他工作的情况
        if (projectData.directItems.length > 0) {
          let otherItemCounter = 1;
          projectData.directItems.forEach(item => {
            markdownContent += `${otherItemCounter}. ${item.content}\n`;
            otherItemCounter++;
          });
          markdownContent += '\n';
        }
      }

      // 其他工作（未选择工作项的内容）- 显示工作项时单独处理
      if (showWorkItems && Object.keys(projectData.workItems).length > 0 && projectData.directItems.length > 0) {
        markdownContent += `### 其他工作\n`;
        let otherItemCounter = 1; // 其他工作的序号从1开始
        projectData.directItems.forEach(item => {
          markdownContent += `${otherItemCounter}. ${item.content}\n`;
          otherItemCounter++;
        });
        markdownContent += '\n';
      }
    });

    copyToClipboard(markdownContent, 'Markdown格式内容已复制到剪贴板');
  };

  // 复制项目周报为YAML格式
  const handleCopyYaml = (reportData: GroupedProjectData[]) => {
    let yamlContent = '';

    reportData.forEach(projectData => {
      yamlContent += `${projectData.project.name}:\n`;

      // 按工作项分组的工作
      if (showWorkItems && Object.keys(projectData.workItems).length > 0) {
        if (showHierarchy) {
          // 层级模式：带层级路径的工作项标识
          projectData.workItemsHierarchy.forEach(hierarchyItem => {
            yamlContent += `  ${hierarchyItem.fullPath}:\n`;
            const mergedContent = projectData.workItems[hierarchyItem.id]?.mergedContent ||
                                 hierarchyItem.items.map(item => item.content).join('\n');
            mergedContent.split('\n').forEach(line => {
              if (line.trim()) {
                yamlContent += `    - ${line.trim()}\n`;
              }
            });
          });
        } else {
          // 简单模式：带工作项名称的标识
          Object.values(projectData.workItems).forEach(workItemData => {
            yamlContent += `  ${workItemData.workItem.name}:\n`;
            workItemData.mergedContent.split('\n').forEach(line => {
              if (line.trim()) {
                yamlContent += `    - ${line.trim()}\n`;
              }
            });
          });
        }

        // 其他工作（未选择工作项的内容）- 显示工作项时单独处理
        if (projectData.directItems.length > 0) {
          yamlContent += `  其他工作:\n`;
          projectData.directItems.forEach(item => {
            yamlContent += `    - ${item.content}\n`;
          });
        }
      } else if (!showWorkItems && Object.keys(projectData.workItems).length > 0) {
        // 隐藏工作项时：直接在项目下列出所有内容
        Object.values(projectData.workItems).forEach(workItemData => {
          workItemData.mergedContent.split('\n').forEach(line => {
            if (line.trim()) {
              yamlContent += `  - ${line.trim()}\n`;
            }
          });
        });
        // 其他工作
        projectData.directItems.forEach(item => {
          yamlContent += `  - ${item.content}\n`;
        });
      } else {
        // 只有其他工作的情况
        projectData.directItems.forEach(item => {
          yamlContent += `  - ${item.content}\n`;
        });
      }

      yamlContent += '\n';
    });

    copyToClipboard(yamlContent, 'YAML格式内容已复制到剪贴板');
  };

  // 通用复制函数
  const copyToClipboard = (text: string, successMessage: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
          .then(() => {
            toast.add({ title: successMessage, type: 'success' });
          })
          .catch(err => {
            console.error('复制失败:', err);
            fallbackCopyTextToClipboard(text, successMessage);
          });
      } else {
        fallbackCopyTextToClipboard(text, successMessage);
      }
    } catch (err) {
      console.error('复制失败:', err);
      toast.add({ title: '复制失败，请重试', type: 'error' });
    }
  };

  // 回退复制方法
  const fallbackCopyTextToClipboard = (text: string, successMessage: string) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;

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
          toast.add({ title: successMessage, type: 'success' });
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

  // 周导航
  const goToPreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const goToNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const goToCurrentWeek = () => {
    setCurrentWeek(new Date());
  };

  // 年度导航
  const goToPreviousYear = () => {
    setCurrentYear(currentYear - 1);
    setIsYearManuallyChanged(true);
  };

  const goToNextYear = () => {
    setCurrentYear(currentYear + 1);
    setIsYearManuallyChanged(true);
  };

  const goToCurrentYear = () => {
    setCurrentYear(new Date().getFullYear());
    setIsYearManuallyChanged(false); // 回到当前年份时重置标志
  };

  // 初始化数据
  useEffect(() => {
    if (user && !dataLoadedRef.current) {
      fetchProjectReports();
      fetchProjects();
    }
  }, [user, fetchProjectReports, fetchProjects]);

  // 生成年度数据 - 确保总是有数据显示
  useEffect(() => {
    generateYearlyData();
  }, [generateYearlyData]);

  // 确保页面加载时就有年度数据显示
  useEffect(() => {
    // 即使没有reports数据，也要初始化年度数据
    if (Object.keys(yearlyData).length === 0) {
      const initialYearData: { [week: number]: { hasReport: boolean } } = {};
      for (let week = 1; week <= 53; week++) {
        initialYearData[week] = { hasReport: false };
      }
      setYearlyData(initialYearData);
    }
  }, [yearlyData]);

  // 初始化时同步当前周的年份到年度显示
  const [isYearManuallyChanged, setIsYearManuallyChanged] = useState(false);

  useEffect(() => {
    // 只在用户没有手动改变年份时才自动同步
    if (!isYearManuallyChanged && currentWeekData.year !== currentYear) {
      setCurrentYear(currentWeekData.year);
    }
  }, [currentWeekData.year, currentYear, setCurrentYear, isYearManuallyChanged]);

  // 添加页面可见性监听
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('项目周报页面恢复可见，保持现有数据');
          // 不再自动刷新数据，保持现有数据
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">项目周报管理</h1>

      {/* 今日周报提醒 */}
      {todayWeekReportReminder && !todayWeekReportReminder.hasReport && (
        <Alert>
          <AlertCircleIcon data-icon="inline-start" />
          <AlertDescription>
            您本周还没有填写项目周报，
            <Link
              to={`/dashboard/project-reports/new?year=${todayWeekReportReminder.year}&week=${todayWeekReportReminder.week_number}`}
              className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
            >
              立即填写
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* 年度填写情况展示 - 独立区域 */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>
            {currentYear}年填写情况
          </CardTitle>
          <CardAction>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <IconTooltipButton onClick={goToPreviousYear} label="上一年" tooltip="上一年">
                <ChevronLeftIcon data-icon="inline-start" />
              </IconTooltipButton>
              <span className="font-medium text-foreground">
                {currentYear}
              </span>
              <IconTooltipButton onClick={goToNextYear} label="下一年" tooltip="下一年">
                <ChevronRightIcon data-icon="inline-start" />
              </IconTooltipButton>
              <Button variant="outline" size="sm"
                onClick={goToCurrentYear}
              >
                今年
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">

          {/* 紧凑的周数展示 */}
          <div className="flex flex-col gap-1.5">
            {[
              { name: 'Q1', start: 1, end: 13 },
              { name: 'Q2', start: 14, end: 26 },
              { name: 'Q3', start: 27, end: 39 },
              { name: 'Q4', start: 40, end: 53 }
            ].map((quarter) => (
              <div key={quarter.name} className="flex items-center gap-2">
                <div className="w-6 text-xs font-medium text-muted-foreground">{quarter.name}</div>
                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: quarter.end - quarter.start + 1 }, (_, index) => {
                    const weekNumber = quarter.start + index;
                    const weekData = yearlyData[weekNumber] || { hasReport: false };
                    const isCurrentWeek = currentWeekData.year === currentYear && currentWeekData.week_number === weekNumber;

                    let bgColor = 'bg-muted hover:bg-muted/70';
                    let statusText = '未填写';

                    if (weekData.hasReport) {
                      bgColor = 'bg-success hover:bg-success/80';
                      statusText = '已填写';
                    }

                    return (
                      <div
                        key={weekNumber}
                        className={cn(
                          'size-3 cursor-pointer rounded-sm transition-colors duration-200',
                          bgColor,
                          isCurrentWeek && 'ring-1 ring-ring'
                        )}
                        title={`第${weekNumber}周 (${statusText})`}
                        onClick={() => {
                          // 点击跳转到对应周
                          const targetDate = new Date(currentYear, 0, 1 + (weekNumber - 1) * 7);
                          setCurrentWeek(targetDate);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 统计信息 */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-sm bg-success" />
                <span>已填写</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-sm bg-muted" />
                <span>未填写</span>
              </div>
            </div>
            <div>
              {Object.values(yearlyData).filter(data => data.hasReport).length} / 53 周
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 周导航 */}
      <Card>
        <CardHeader className="border-b border-border">
          {/* 移动端：垂直布局 */}
          <div className="block md:hidden">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-base font-medium">项目周报</h2>
              <Button render={<Link to={`/dashboard/project-reports/new?year=${currentWeekData.year}&week=${currentWeekData.week_number}`} />}>
                <PlusIcon data-icon="inline-start" />
                新建周报
              </Button>
            </div>

            {/* 移动端控制区域 */}
            <div className="flex flex-col gap-3">
              {/* 项目筛选 - 移动端全宽 */}
              <Field>
                <FieldLabel htmlFor="project-filter-mobile">筛选项目</FieldLabel>
                <Select value={selectedProjectId || "__all"} onValueChange={(value: string | null) => setSelectedProjectId(value === null || value === "__all" ? "" : value)} items={[{ label: '全部项目', value: '__all' }, ...projects.map((project) => ({ label: project.name, value: project.id }))]}>
                  <SelectTrigger id="project-filter-mobile" className="w-full">
                    <SelectValue placeholder="全部项目" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__all">全部项目</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError errors={[]} />
              </Field>

              {/* 时间导航和本周按钮 */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <IconTooltipButton onClick={goToPreviousWeek} label="上一周" tooltip="上一周">
                    <ChevronLeftIcon data-icon="inline-start" />
                  </IconTooltipButton>
                  <span className="font-medium whitespace-nowrap text-foreground">
                    {currentWeekData.year}年第{currentWeekData.week_number}周
                  </span>
                  <IconTooltipButton onClick={goToNextWeek} label="下一周" tooltip="下一周">
                    <ChevronRightIcon data-icon="inline-start" />
                  </IconTooltipButton>
                </div>
                <div className="flex items-center gap-2">
                  {selectedProjectId && (
                    <Button variant="ghost" size="sm"
                      onClick={() => setSelectedProjectId('')}
                    >
                      <XIcon data-icon="inline-start" />
                      清除
                    </Button>
                  )}
                  <Button variant="outline" size="sm"
                    onClick={goToCurrentWeek}
                  >
                    本周
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* 桌面端：水平布局 */}
          <div className="hidden md:flex justify-between items-center">
            <h2 className="text-lg font-medium">
              项目周报
            </h2>
            <div className="flex items-center gap-4">
              {/* 项目筛选 */}
              <Field orientation="horizontal">
                <FieldLabel htmlFor="project-filter-desktop">筛选项目</FieldLabel>
                <Select value={selectedProjectId || "__all"} onValueChange={(value: string | null) => setSelectedProjectId(value === null || value === "__all" ? "" : value)} items={[{ label: '全部项目', value: '__all' }, ...projects.map((project) => ({ label: project.name, value: project.id }))]}>
                  <SelectTrigger id="project-filter-desktop">
                    <SelectValue placeholder="全部项目" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__all">全部项目</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {selectedProjectId && (
                  <IconTooltipButton onClick={() => setSelectedProjectId('')} label="清除筛选" tooltip="清除筛选" size="icon-sm">
                    <XIcon data-icon="inline-start" />
                  </IconTooltipButton>
                )}
                <FieldError errors={[]} />
              </Field>

              {/* 时间导航 */}
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <IconTooltipButton onClick={goToPreviousWeek} label="上一周" tooltip="上一周">
                  <ChevronLeftIcon data-icon="inline-start" />
                </IconTooltipButton>
                <span className="font-medium whitespace-nowrap text-foreground">
                  {currentWeekData.year}年第{currentWeekData.week_number}周
                </span>
                <IconTooltipButton onClick={goToNextWeek} label="下一周" tooltip="下一周">
                  <ChevronRightIcon data-icon="inline-start" />
                </IconTooltipButton>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm"
                  onClick={goToCurrentWeek}
                >
                  本周
                </Button>
                <Button render={<Link to={`/dashboard/project-reports/new?year=${currentWeekData.year}&week=${currentWeekData.week_number}`} />}>
                  <PlusIcon data-icon="inline-start" />
                  新建周报
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>

        {/* 周报内容 */}
        <CardContent>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 md:py-12">
              <Spinner className="size-4" />
              <span className="text-sm text-muted-foreground md:text-base">加载中...</span>
            </div>
          ) : currentWeekData.report ? (
            <div className="flex flex-col gap-3 md:gap-4">

              {/* 第一行：标题行 */}
              <div className="flex flex-wrap items-center gap-2">
                <FileTextIcon className="size-5 text-primary" />
                <span className="text-sm font-medium md:text-base">
                  {currentWeekData.report.formattedPeriod} 项目周报
                  {selectedProjectId && (
                    <span className="ml-2 text-xs text-muted-foreground md:text-sm">
                      ({projects.find(p => p.id === selectedProjectId)?.name})
                    </span>
                  )}
                </span>
              </div>

              {/* 第二行及以后：所有操作按钮，支持自动换行 */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 显示控制开关 */}
                <Button variant="outline" size="sm"
                  onClick={() => setShowWorkItems(!showWorkItems)}
                  className={showWorkItems ? 'border-primary/30 bg-accent text-primary' : undefined}
                  title={showWorkItems ? '隐藏工作项' : '显示工作项'}
                >
                  {showWorkItems ? <EyeIcon data-icon="inline-start" /> : <EyeOffIcon data-icon="inline-start" />}
                  工作项
                </Button>

                {showWorkItems && (
                  <Button variant="outline" size="sm"
                    onClick={() => setShowHierarchy(!showHierarchy)}
                    className={showHierarchy ? 'border-success/30 bg-success/10 text-success' : undefined}
                    title={showHierarchy ? '隐藏层级' : '显示层级'}
                  >
                    层级
                  </Button>
                )}

                {/* 复制按钮 */}
                <Button variant="outline" size="sm"
                  onClick={() => handleCopyMarkdown(groupedProjectData)}
                  title="复制为Markdown格式"
                >
                  <CopyIcon data-icon="inline-start" />
                  MD
                </Button>

                <Button variant="outline" size="sm"
                  onClick={() => handleCopyYaml(groupedProjectData)}
                  title="复制为YAML格式"
                >
                  <CopyIcon data-icon="inline-start" />
                  YML
                </Button>

                {/* 编辑和删除按钮（所有设备都显示） */}
                <Button variant="outline" size="sm"
                  render={<Link to={`/dashboard/project-reports/new?year=${currentWeekData.year}&week=${currentWeekData.week_number}`} />}
                >
                  <PencilIcon data-icon="inline-start" />
                  编辑
                </Button>

                <Button variant="destructive" size="sm"
                  onClick={(e) => handleDeleteClick(e, currentWeekData.report!.id)}
                >
                  <TrashIcon data-icon="inline-start" />
                  删除
                </Button>
              </div>
              
              {/* 筛选结果统计 */}
              {selectedProjectId && (
                <div className="text-xs text-muted-foreground">
                  显示 {groupedProjectData.length} 个项目的工作内容
                </div>
              )}

              {/* 周报条目 - 参考日报预览样式 */}
              <div className="flex flex-col gap-3 md:gap-4">
                {groupedProjectData.length > 0 ? groupedProjectData.map((projectData) => (
                  <div key={projectData.project.id} className="flex flex-col gap-1 border-l-2 border-primary py-1 pl-2 md:gap-2 md:pl-4">
                    {/* 项目标题 - 参考日报样式 */}
                    <div className="flex flex-wrap items-center gap-1">
                      <div className={cn('text-sm font-medium', projectData.project.is_active === false ? 'text-muted-foreground' : 'text-primary')}>
                        {projectData.project.name}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        ({projectData.project.code})
                      </div>
                      {projectData.project.is_active === false && (
                        <Badge variant="destructive">
                          已删除
                        </Badge>
                      )}
                    </div>

                    {/* 项目内容 - 简化列表 */}
                    {/* 统一的工作内容列表 - 工作项单独一行，内容带序号 */}
                    <div className="flex flex-col gap-2 md:gap-3">
                        {/* 按工作项分组的工作 */}
                        {showWorkItems && Object.keys(projectData.workItems).length > 0 && (
                          <>
                            {showHierarchy ? (
                              // 层级模式：显示完整的工作项层级路径
                              projectData.workItemsHierarchy.map((hierarchyItem) => {
                                const mergedContent = projectData.workItems[hierarchyItem.id]?.mergedContent ||
                                                     hierarchyItem.items.map(item => item.content).join('\n');
                                const contentLines = mergedContent.split('\n').filter(line => line.trim());

                                // 检查工作项是否已删除
                                const workItemData = projectData.workItems[hierarchyItem.id];
                                const isWorkItemDeleted = workItemData?.items.some(item =>
                                  getWorkItemDisplayInfo(item)?.isDeleted
                                );

                                return (
                                  <div key={hierarchyItem.id} className="flex flex-col gap-1 text-xs md:text-sm">
                                    {/* 工作项标题单独一行 */}
                                    <div className={cn('flex flex-wrap items-center gap-1.5 font-medium', isWorkItemDeleted ? 'text-muted-foreground' : 'text-primary')}>
                                      <span>{hierarchyItem.fullPath}</span>
                                      {isWorkItemDeleted && (
                                        <Badge variant="destructive">
                                          已删除
                                        </Badge>
                                      )}
                                    </div>
                                    {/* 工作内容带序号 */}
                                    <div className="ml-2 flex flex-col gap-0.5">
                                      {contentLines.map((line, index) => (
                                        <div key={index} className="flex items-start gap-2 text-foreground">
                                          <span className="shrink-0 font-medium text-primary">
                                            {index + 1}.
                                          </span>
                                          <span className="break-words">{line.trim()}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              // 简单模式：显示工作项名称
                              Object.values(projectData.workItems).map((workItemData) => {
                                const contentLines = workItemData.mergedContent.split('\n').filter(line => line.trim());

                                // 检查工作项是否已删除
                                const isWorkItemDeleted = workItemData.items.some(item =>
                                  getWorkItemDisplayInfo(item)?.isDeleted
                                );

                                return (
                                  <div key={workItemData.workItem.id} className="text-xs md:text-sm">
                                    {/* 工作项标题单独一行 */}
                                    <div className={`font-medium mb-1 flex items-center ${isWorkItemDeleted ? 'text-gray-500' : 'text-blue-500'}`}>
                                      <span>{workItemData.workItem.name}</span>
                                      {isWorkItemDeleted && (
                                        <Badge variant="destructive" className="ml-2">
                                          已删除
                                        </Badge>
                                      )}
                                    </div>
                                    {/* 工作内容带序号 */}
                                    <div className="flex flex-col ml-2 gap-0.5">
                                      {contentLines.map((line, index) => (
                                        <div key={index} className="text-gray-600 flex items-start">
                                          <span className="mr-2 text-blue-400 shrink-0 font-medium">
                                            {index + 1}.
                                          </span>
                                          <span className="break-words">{line.trim()}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </>
                        )}

                        {/* 当隐藏工作项时，显示所有内容的简化视图 */}
                        {!showWorkItems && (Object.keys(projectData.workItems).length > 0 || projectData.directItems.length > 0) && (
                          <div className="text-xs md:text-sm">
                            <div className="flex flex-col gap-0.5">
                              {[
                                // 工作项内容
                                ...Object.values(projectData.workItems).flatMap(workItemData =>
                                  workItemData.mergedContent.split('\n').filter(line => line.trim())
                                ),
                                // 其他工作内容
                                ...projectData.directItems.map(item => item.content.trim()).filter(content => content)
                              ].map((line, index) => (
                                <div key={index} className="text-gray-600 flex items-start">
                                  <span className="mr-2 text-blue-400 shrink-0 font-medium">
                                    {index + 1}.
                                  </span>
                                  <span className="break-words">{line}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 其他工作（未选择工作项的内容）- 只在显示工作项时单独显示 */}
                        {showWorkItems && projectData.directItems.length > 0 && (
                          <div className="text-xs md:text-sm">
                            {/* 其他工作标题单独一行 */}
                            <div className="text-blue-500 font-medium mb-1">
                              其他工作
                            </div>
                            {/* 其他工作内容带序号 */}
                            <div className="flex flex-col ml-2 gap-0.5">
                              {projectData.directItems.map((item, index) => (
                                <div key={item.id} className="text-gray-600 flex items-start">
                                  <span className="mr-2 text-blue-400 shrink-0 font-medium">
                                    {index + 1}.
                                  </span>
                                  <span className="break-words">{item.content}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                )) : (
                  /* 筛选后无结果的提示 */
                  selectedProjectId && (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>该项目本周暂无工作内容</EmptyTitle>
                        <EmptyDescription>
                          项目"{projects.find(p => p.id === selectedProjectId)?.name}"在本周没有记录工作内容
                        </EmptyDescription>
                      </EmptyHeader>
                      <Button variant="outline" size="sm"
                        onClick={() => setSelectedProjectId('')}
                      >
                        查看所有项目
                      </Button>
                    </Empty>
                  )
                )}
              </div>
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarIcon data-icon="inline-start" />
                </EmptyMedia>
                <EmptyTitle>暂无项目周报</EmptyTitle>
                <EmptyDescription>
                  点击上方"新建周报"按钮开始填写本周的项目周报
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      {/* 删除确认对话框 */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={(open) => { if (!open) handleCancelDelete(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除这个项目周报吗？此操作无法撤销。</AlertDialogDescription>
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
