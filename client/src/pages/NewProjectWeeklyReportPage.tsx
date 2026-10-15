
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarIcon, PlusIcon, TrashIcon, SaveIcon, ArrowLeftIcon, BookmarkIcon, EyeIcon, EyeOffIcon, CopyIcon, FileTextIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Link } from 'react-router-dom';
import { useAuth } from "../contexts/auth-context";
import { apiGet, apiPost } from "../lib/api";
import type { Project, WorkBreakdownItem as DbWorkBreakdownItem } from "../lib/db/types";
import { toast } from "@/components/ui/toast";
import { format, startOfISOWeek, endOfISOWeek, getISOWeek, getYear } from "date-fns";
import { zhCN } from "date-fns/locale";
import { usePersistentState, clearPageState } from "../lib/utils/page-persistence";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";


interface WorkItem {
  id?: string;
  content: string;
  projectId: string;
  workItemId?: string;
}

interface WorkBreakdownItemWithChildren {
  id: string;
  name: string;
  level: number;
  parent_id: string | null;
  children?: WorkBreakdownItemWithChildren[];
}

// 拍平工作分解树，供 Select items 做 label 映射（base-nova 下 SelectValue 只认 items，不认 JSX）
const flattenWorkItemOptions = (list: WorkBreakdownItemWithChildren[]): { label: string; value: string }[] =>
  list.flatMap((item) => [
    { label: item.name, value: item.id },
    ...flattenWorkItemOptions(item.children || []),
  ]);

interface WorkItemSelectorProps {
  id?: string;
  projectId: string;
  items: WorkBreakdownItemWithChildren[];
  selectedWorkItemId?: string;
  onChange?: (value: string) => void;
  onLoadRequest?: (projectId: string) => void;
}

// 工作分解项选择器：抽成局部组件，避免每个工作项行都重复一整套 Select
function WorkItemSelector({ id, projectId, items, selectedWorkItemId, onChange, onLoadRequest }: WorkItemSelectorProps) {
  // 如果工作项还没有加载，尝试加载
  if (items.length === 0 && projectId) {
    onLoadRequest?.(projectId);
  }

  const renderOptions = (list: WorkBreakdownItemWithChildren[], level = 0): JSX.Element[] => {
    const options: JSX.Element[] = [];

    list.forEach(item => {
      const indent = '　'.repeat(level);
      options.push(
        <SelectItem key={item.id} value={item.id}>
          {indent}{item.name}
        </SelectItem>
      );

      if (item.children && item.children.length > 0) {
        options.push(...renderOptions(item.children, level + 1));
      }
    });

    return options;
  };

  return (
    <Select value={selectedWorkItemId || "__none"} onValueChange={(value: string | null) => onChange?.(value === null || value === "__none" ? "" : value)} items={[{ label: '选择工作项（可选）', value: '__none' }, ...flattenWorkItemOptions(items)]}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="选择工作项（可选）" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="__none">选择工作项（可选）</SelectItem>
          {renderOptions(items)}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

interface PreviewTogglesProps {
  showWorkItems: boolean;
  showHierarchy: boolean;
  onChange: (showWorkItems: boolean, showHierarchy: boolean) => void;
}

// 预览显示控制（工作项 / 层级）——用 ToggleGroup 表达 pressed 状态
function PreviewToggles({ showWorkItems, showHierarchy, onChange }: PreviewTogglesProps) {
  return (
    <ToggleGroup
      multiple
      variant="outline"
      size="sm"
      value={[
        ...(showWorkItems ? ['work-items'] : []),
        ...(showHierarchy ? ['hierarchy'] : []),
      ]}
      onValueChange={(value) => onChange(value.includes('work-items'), value.includes('hierarchy'))}
    >
      <ToggleGroupItem value="work-items" title={showWorkItems ? '隐藏工作项' : '显示工作项'}>
        {showWorkItems ? <EyeIcon data-icon="inline-start" /> : <EyeOffIcon data-icon="inline-start" />}
        工作项
      </ToggleGroupItem>
      {showWorkItems && (
        <ToggleGroupItem value="hierarchy" title={showHierarchy ? '隐藏层级' : '显示层级'}>
          层级
        </ToggleGroupItem>
      )}
    </ToggleGroup>
  );
}

export default function NewProjectWeeklyReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  
  // 从URL参数获取年份和周数
  const yearParam = searchParams.get('year');
  const weekParam = searchParams.get('week');
  
  // 计算默认的年份和周数
  const today = new Date();
  const defaultYear = yearParam ? parseInt(yearParam) : getYear(startOfISOWeek(today));
  const defaultWeek = weekParam ? parseInt(weekParam) : getISOWeek(startOfISOWeek(today));
  
  // 状态管理
  const [year, setYear] = usePersistentState('project-weekly-report-year', defaultYear);
  const [weekNumber, setWeekNumber] = usePersistentState('project-weekly-report-week', defaultWeek);
  const [workItems, setWorkItems] = usePersistentState<WorkItem[]>('project-weekly-report-work-items', []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workBreakdownItems, setWorkBreakdownItems] = useState<{ [projectId: string]: WorkBreakdownItemWithChildren[] }>({});
  const [allWorkItems, setAllWorkItems] = useState<{ [projectId: string]: DbWorkBreakdownItem[] }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  // 预览相关状态
  const [showPreview, setShowPreview] = useState(false);

  // 项目选择状态
  const [selectedProjectId, setSelectedProjectId] = useState('');

  // 预览显示控制状态
  const [showWorkItems, setShowWorkItems] = useState(true);
  const [showHierarchy, setShowHierarchy] = useState(true);

  // 添加数据加载状态引用
  const dataLoadedRef = useRef(false);
  const isRequestingRef = useRef(false);
  const urlParamsCheckedRef = useRef(false);
  
  // 计算周的开始和结束日期
  const getWeekDates = (year: number, week: number) => {
    // 创建该年第一周的日期
    const jan4 = new Date(year, 0, 4); // 1月4日总是在第一周
    const firstWeekStart = startOfISOWeek(jan4);
    
    // 计算目标周的开始日期
    const targetWeekStart = new Date(firstWeekStart);
    targetWeekStart.setDate(firstWeekStart.getDate() + (week - 1) * 7);
    
    const weekStart = startOfISOWeek(targetWeekStart);
    const weekEnd = endOfISOWeek(targetWeekStart);
    
    return { weekStart, weekEnd };
  };

  const { weekStart, weekEnd } = getWeekDates(year, weekNumber);
  const formattedPeriod = `${format(weekStart, 'M月d日', { locale: zhCN })} - ${format(weekEnd, 'M月d日', { locale: zhCN })}`;

  // 构建工作项路径的辅助函数
  const buildWorkItemPath = useCallback((workItem: any, allWorkItems: any[]): string => {
    const path: string[] = [];
    let currentItem = workItem;

    // 递归向上查找父级工作项
    while (currentItem) {
      path.unshift(currentItem.name);
      if (currentItem.parent_id) {
        currentItem = allWorkItems.find(item => item.id === currentItem.parent_id);
      } else {
        break;
      }
    }

    return path.join(' > ');
  }, []);

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

  // 加载工作分解项
  const fetchWorkBreakdownItems = useCallback(async (projectId: string) => {
    if (!user || !projectId) return;

    try {
      const data = await apiGet<{ items: DbWorkBreakdownItem[] }>(
        `/api/work-breakdown/items?project_id=${encodeURIComponent(projectId)}`
      );

      // 构建树形结构
      const items = (data.items || []) as DbWorkBreakdownItem[];
      const itemMap: { [id: string]: WorkBreakdownItemWithChildren } = {};
      const rootItems: WorkBreakdownItemWithChildren[] = [];

      // 创建所有项目的映射
      items.forEach((item: DbWorkBreakdownItem) => {
        itemMap[item.id] = {
          ...item,
          children: []
        };
      });

      // 构建父子关系
      items.forEach((item: DbWorkBreakdownItem) => {
        if (item.parent_id && itemMap[item.parent_id]) {
          itemMap[item.parent_id].children!.push(itemMap[item.id]);
        } else {
          rootItems.push(itemMap[item.id]);
        }
      });
      
      setWorkBreakdownItems(prev => ({
        ...prev,
        [projectId]: rootItems
      }));

      // 同时更新allWorkItems，包含所有项目（扁平化）
      setAllWorkItems(prev => ({
        ...prev,
        [projectId]: items
      }));
    } catch (error) {
      console.error('获取工作分解项失败', error);
      toast.add({ title: '获取工作分解项失败', type: 'error' });
    }
  }, [user]);

  // 加载现有的项目周报数据
  const fetchExistingReport = useCallback(async (targetYear: number, targetWeek: number, forceUpdate: boolean = false) => {
    if (!user) return;

    // 使用传入的参数
    const reportYear = targetYear;
    const reportWeek = targetWeek;

    // 检查是否正在请求中，避免重复请求
    const requestKey = `${reportYear}-${reportWeek}`;
    if (isRequestingRef.current) {
      console.log('项目周报编辑页面正在请求中，跳过重复请求');
      return;
    }

    // 检查数据是否已经加载过，如果强制更新则忽略此检查
    if (!forceUpdate && dataLoadedRef.current) {
      console.log('项目周报编辑数据已加载，跳过重新获取');
      return;
    }

    console.log(`加载项目周报编辑数据${forceUpdate ? '(强制刷新)' : ''}: ${reportYear}年第${reportWeek}周`);

    // 设置请求状态
    isRequestingRef.current = true;
    setIsLoading(true);
    try {
      const data = await apiGet<{ report: any | null }>(
        `/api/project-weekly-reports?year=${reportYear}&week_number=${reportWeek}`
      );
      const reportData = data.report;

      if (reportData) {
        setReportId(reportData.id as string);

        // 报告条目已包含在响应中
        const items: WorkItem[] = (reportData.items || []).map((item: any) => ({
          id: item.id,
          content: item.content,
          projectId: item.project_id,
          workItemId: item.work_item_id || undefined
        }));

        setWorkItems(items);

        // 为每个项目加载工作分解项
        const projectIds = Array.from(new Set(items.map(item => item.projectId)));
        for (const projectId of projectIds) {
          await fetchWorkBreakdownItems(projectId);
        }
      }

      // 标记数据已加载
      dataLoadedRef.current = true;

    } catch (error) {
      console.error('获取现有报告失败', error);
      toast.add({ title: '获取现有报告失败', type: 'error' });
    } finally {
      // 清除请求状态
      isRequestingRef.current = false;
      setIsLoading(false);
    }
  }, [user, fetchWorkBreakdownItems]);

  // 添加工作项 - 使用选择的项目ID
  const addWorkItem = async () => {
    // 使用选择的项目ID，如果没有则获取最后一个工作项的项目ID作为默认值
    const projectId = selectedProjectId || (workItems.length > 0
      ? workItems[workItems.length - 1].projectId
      : (projects.length > 0 ? projects[0].id : ''));

    if (projectId === '') {
      toast.add({ title: '请先选择一个项目', type: 'error' });
      return;
    }

    // 确保该项目的工作分解项已加载
    if (!workBreakdownItems[projectId]) {
      await fetchWorkBreakdownItems(projectId);
    }

    setWorkItems([...workItems, { content: '', projectId }]);

    // 重置选择的项目ID
    setSelectedProjectId('');
  };

  // 添加特定项目的工作项
  const handleAddWorkItem = async (projectId: string) => {
    if (!projectId) return; // 安全检查

    // 确保该项目的工作分解项已加载
    if (!workBreakdownItems[projectId]) {
      await fetchWorkBreakdownItems(projectId);
    }

    setWorkItems([...workItems, { content: '', projectId }]);
  };

  // 删除工作项
  const removeWorkItem = (index: number) => {
    if (index < 0 || index >= workItems.length) return; // 安全检查

    const newItems = [...workItems];
    newItems.splice(index, 1);
    setWorkItems(newItems);
  };

  // 更新工作项
  const updateWorkItem = (index: number, field: keyof WorkItem, value: string) => {
    const newItems = [...workItems];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // 如果更改了项目，清空工作项选择并加载新的工作分解项
    if (field === 'projectId') {
      newItems[index].workItemId = undefined;
      if (value) {
        fetchWorkBreakdownItems(value);
      }
    }
    
    setWorkItems(newItems);
  };

  // 计算按项目分组的工作项 - 使用useMemo确保稳定性
  const workItemsGroupedByProject = useMemo(() => {
    return projects
      .map(project => {
        const projectItems = workItems.filter(item => item.projectId === project.id)
          .map((item, index) => ({
            ...item,
            tempId: item.id || `temp-${project.id}-${index}`,
            globalIndex: workItems.findIndex(wi => wi === item) // 添加全局索引
          }));

        // 计算项目的首次出现时间
        const firstAppearanceIndex = workItems.findIndex(item => item.projectId === project.id);

        return {
          projectId: project.id,
          projectName: `${project.name} (${project.code})`,
          sortIndex: firstAppearanceIndex === -1 ? Number.MAX_SAFE_INTEGER : firstAppearanceIndex,
          items: projectItems
        };
      })
      // 只显示用户已添加的项目（即已在workItems中使用的项目）
      .filter(group => workItems.some(item => item.projectId === group.projectId))
      .sort((a, b) => a.sortIndex - b.sortIndex); // 按项目在工作项中的首次出现顺序排序
  }, [projects, workItems]);

  // 计算可用的项目（已选择的项目不再显示）
  const availableProjects = useMemo(() => {
    const usedProjectIds = Array.from(new Set(workItems.map(item => item.projectId)))
      .filter(id => id !== ''); // 过滤空项目ID

    return projects
      .filter(project =>
        // 允许选择所有未被使用的项目
        !usedProjectIds.includes(project.id)
      );
  }, [projects, workItems]);

  // 构建带快照字段的条目（服务端按 年+周 upsert，明细全量替换）
  const buildSnapshotItems = (validItems: WorkItem[]) => {
    return validItems.map((item) => {
      // 获取项目信息用于快照
      const project = projects.find(pr => pr.id === item.projectId);

      // 获取工作项信息用于快照
      let workItemName = null;
      let workItemPath = null;
      if (item.workItemId && workBreakdownItems[item.projectId]) {
        const workItem = workBreakdownItems[item.projectId].find(w => w.id === item.workItemId);
        if (workItem) {
          workItemName = workItem.name;
          // 构建工作项路径
          workItemPath = buildWorkItemPath(workItem, workBreakdownItems[item.projectId]);
        }
      }

      return {
        project_id: item.projectId,
        work_item_id: item.workItemId || null,
        content: item.content.trim(),
        // 快照字段
        project_name: project?.name || null,
        project_code: project?.code || null,
        work_item_name: workItemName,
        work_item_path: workItemPath
      };
    });
  };

  // 暂存项目周报（服务端按 年+周 upsert，明细全量替换）
  const saveDraft = async () => {
    if (!user) return;

    // 暂存不需要验证数据，允许保存空内容
    const validItems = workItems.filter(item => item.content.trim() && item.projectId);

    setIsSavingDraft(true);
    try {
      const res = await apiPost<{ report: { id: string } }>('/api/project-weekly-reports', {
        year,
        week_number: weekNumber,
        start_date: format(weekStart, 'yyyy-MM-dd'),
        end_date: format(weekEnd, 'yyyy-MM-dd'),
        items: buildSnapshotItems(validItems),
      });

      setReportId(res.report.id);

      toast.add({ title: '项目周报暂存成功', type: 'success' });

      // 暂存后不清除页面状态，也不跳转
    } catch (error) {
      console.error('暂存项目周报失败', error);
      toast.add({ title: '暂存项目周报失败', type: 'error' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  // 保存项目周报（服务端按 年+周 upsert，明细全量替换）
  const saveReport = async () => {
    if (!user) return;

    // 验证数据
    const validItems = workItems.filter(item => item.content.trim() && item.projectId);
    if (validItems.length === 0) {
      toast.add({ title: '请至少添加一个有效的工作项', type: 'error' });
      return;
    }

    setIsSavingReport(true);
    try {
      const res = await apiPost<{ report: { id: string } }>('/api/project-weekly-reports', {
        year,
        week_number: weekNumber,
        start_date: format(weekStart, 'yyyy-MM-dd'),
        end_date: format(weekEnd, 'yyyy-MM-dd'),
        items: buildSnapshotItems(validItems),
      });

      setReportId(res.report.id);

      toast.add({ title: '项目周报保存成功', type: 'success' });

      // 清除页面状态
      clearPageState('project-weekly-report');

      // 返回列表页
      navigate('/dashboard/project-reports');
    } catch (error) {
      console.error('保存项目周报失败', error);
      toast.add({ title: '保存项目周报失败', type: 'error' });
    } finally {
      setIsSavingReport(false);
    }
  };

  // 切换预览模式
  const togglePreview = () => {
    setShowPreview(!showPreview);
  };

  // 切换到上一周
  const goToPreviousWeek = async () => {
    const currentDate = new Date(year, 0, 1 + (weekNumber - 1) * 7);
    const previousWeek = new Date(currentDate);
    previousWeek.setDate(currentDate.getDate() - 7);

    const newYear = getYear(startOfISOWeek(previousWeek));
    const newWeek = getISOWeek(startOfISOWeek(previousWeek));

    // 立即清空当前状态，避免数据混乱
    setReportId('');
    setWorkItems([]);

    // 重置数据加载状态，允许重新加载
    dataLoadedRef.current = false;

    setYear(newYear);
    setWeekNumber(newWeek);

    // 直接加载新周的数据
    await fetchExistingReport(newYear, newWeek, true);
  };

  // 切换到下一周
  const goToNextWeek = async () => {
    const currentDate = new Date(year, 0, 1 + (weekNumber - 1) * 7);
    const nextWeek = new Date(currentDate);
    nextWeek.setDate(currentDate.getDate() + 7);

    const newYear = getYear(startOfISOWeek(nextWeek));
    const newWeek = getISOWeek(startOfISOWeek(nextWeek));

    // 立即清空当前状态，避免数据混乱
    setReportId('');
    setWorkItems([]);

    // 重置数据加载状态，允许重新加载
    dataLoadedRef.current = false;

    setYear(newYear);
    setWeekNumber(newWeek);

    // 直接加载新周的数据
    await fetchExistingReport(newYear, newWeek, true);
  };

  // 复制为Markdown格式
  const handleCopyMarkdown = () => {
    const previewContent = generatePreviewContent();

    if (!previewContent || previewContent.length === 0) {
      toast.add({ title: '没有可复制的内容', type: 'error' });
      return;
    }

    let markdownContent = '';

    previewContent.forEach((projectData: any) => {
      markdownContent += `## ${projectData.project.name}\n`;

      if (showWorkItems) {
        // 显示工作项时：按工作项分组
        if (Object.keys(projectData.workItems).length > 0) {
          if (showHierarchy && projectData.workItemsHierarchy.length > 0) {
            // 层级模式：显示完整路径
            projectData.workItemsHierarchy.forEach((hierarchyItem: any) => {
              markdownContent += `### ${hierarchyItem.fullPath}\n`;
              let itemCounter = 1;
              hierarchyItem.items.forEach((item: any) => {
                markdownContent += `${itemCounter}. ${item.content}\n`;
                itemCounter++;
              });
            });
          } else {
            // 简单模式：只显示工作项名称
            Object.values(projectData.workItems).forEach((workItemData: any) => {
              markdownContent += `### ${workItemData.workItem.name}\n`;
              let itemCounter = 1;
              workItemData.items.forEach((item: any) => {
                markdownContent += `${itemCounter}. ${item.content}\n`;
                itemCounter++;
              });
            });
          }
        }

        // 其他工作（显示工作项时单独显示）
        if (projectData.directItems.length > 0) {
          markdownContent += `### 其他工作\n`;
          let otherItemCounter = 1;
          projectData.directItems.forEach((item: any) => {
            markdownContent += `${otherItemCounter}. ${item.content}\n`;
            otherItemCounter++;
          });
        }
      } else {
        // 隐藏工作项时：直接列出所有内容
        let itemCounter = 1;
        projectData.items.forEach((item: any) => {
          markdownContent += `${itemCounter}. ${item.content}\n`;
          itemCounter++;
        });
      }

      markdownContent += '\n';
    });

    navigator.clipboard.writeText(markdownContent)
      .then(() => {
        toast.add({ title: 'Markdown格式内容已复制到剪贴板', type: 'success' });
      })
      .catch(err => {
        console.error('复制失败:', err);
        toast.add({ title: '复制失败，请重试', type: 'error' });
      });
  };

  // 复制为YAML格式
  const handleCopyYaml = () => {
    const previewContent = generatePreviewContent();

    if (!previewContent || previewContent.length === 0) {
      toast.add({ title: '没有可复制的内容', type: 'error' });
      return;
    }

    let yamlContent = '';

    previewContent.forEach((projectData: any) => {
      yamlContent += `${projectData.project.name}:\n`;

      if (showWorkItems) {
        // 显示工作项时：按工作项分组
        if (Object.keys(projectData.workItems).length > 0) {
          if (showHierarchy && projectData.workItemsHierarchy.length > 0) {
            // 层级模式：使用完整路径
            projectData.workItemsHierarchy.forEach((hierarchyItem: any) => {
              yamlContent += `  ${hierarchyItem.fullPath}:\n`;
              hierarchyItem.items.forEach((item: any) => {
                yamlContent += `    - ${item.content}\n`;
              });
            });
          } else {
            // 简单模式：使用工作项名称
            Object.values(projectData.workItems).forEach((workItemData: any) => {
              yamlContent += `  ${workItemData.workItem.name}:\n`;
              workItemData.items.forEach((item: any) => {
                yamlContent += `    - ${item.content}\n`;
              });
            });
          }
        }

        // 其他工作（显示工作项时单独显示）
        if (projectData.directItems.length > 0) {
          yamlContent += `  其他工作:\n`;
          projectData.directItems.forEach((item: any) => {
            yamlContent += `    - ${item.content}\n`;
          });
        }
      } else {
        // 隐藏工作项时：直接在项目下列出
        projectData.items.forEach((item: any) => {
          yamlContent += `  - ${item.content}\n`;
        });
      }

      yamlContent += '\n';
    });

    navigator.clipboard.writeText(yamlContent)
      .then(() => {
        toast.add({ title: 'YAML格式内容已复制到剪贴板', type: 'success' });
      })
      .catch(err => {
        console.error('复制失败:', err);
        toast.add({ title: '复制失败，请重试', type: 'error' });
      });
  };

  // 生成预览内容 - 支持工作项和层级显示
  const generatePreviewContent = () => {
    const validItems = workItems.filter(item => item.content.trim() && item.projectId);

    if (validItems.length === 0) {
      return null;
    }

    // 按项目分组
    const projectGroups: { [projectId: string]: any } = {};

    validItems.forEach(item => {
      const project = projects.find(p => p.id === item.projectId);
      if (project) {
        if (!projectGroups[project.id]) {
          projectGroups[project.id] = {
            project,
            items: [],
            workItems: {},
            directItems: [],
            workItemsHierarchy: []
          };
        }

        projectGroups[project.id].items.push(item);

        if (item.workItemId && allWorkItems[project.id]) {
          const workItem = allWorkItems[project.id].find(wi => wi.id === item.workItemId);
          if (workItem) {
            if (!projectGroups[project.id].workItems[item.workItemId]) {
              projectGroups[project.id].workItems[item.workItemId] = {
                workItem,
                items: [],
                mergedContent: ''
              };
            }
            projectGroups[project.id].workItems[item.workItemId].items.push(item);
          } else {
            projectGroups[project.id].directItems.push(item);
          }
        } else {
          projectGroups[project.id].directItems.push(item);
        }
      }
    });

    // 处理工作项层级结构和合并内容
    Object.values(projectGroups).forEach((projectData: any) => {
      // 合并相同工作项的内容
      Object.values(projectData.workItems).forEach((workItemData: any) => {
        const contents = workItemData.items.map((item: any) => item.content).filter((content: string) => content.trim());
        workItemData.mergedContent = contents.join('\n');
      });

      // 构建层级结构
      if (showHierarchy && allWorkItems[projectData.project.id]) {
        const hierarchyMap = new Map();

        Object.values(projectData.workItems).forEach((workItemData: any) => {
          const workItem = workItemData.workItem;
          const fullPath = buildWorkItemPath(workItem, allWorkItems[projectData.project.id]);

          if (!hierarchyMap.has(workItem.id)) {
            hierarchyMap.set(workItem.id, {
              id: workItem.id,
              name: workItem.name,
              level: workItem.level || 0,
              parent_id: workItem.parent_id,
              children: [],
              items: [],
              fullPath: fullPath
            });
          }

          const hierarchyItem = hierarchyMap.get(workItem.id);
          hierarchyItem.items.push(...workItemData.items);
        });

        projectData.workItemsHierarchy = Array.from(hierarchyMap.values());
      }
    });

    return Object.values(projectGroups);
  };



  // 初始化数据
  useEffect(() => {
    if (user && !dataLoadedRef.current) {
      fetchProjects();

      // 检查URL参数
      const checkUrlParams = async () => {
        if (urlParamsCheckedRef.current) return;

        try {
          // 检查URL参数中是否有年份和周数
          const urlParams = new URLSearchParams(window.location.search);
          const yearParam = urlParams.get('year');
          const weekParam = urlParams.get('week');

          if (yearParam && weekParam) {
            const targetYear = parseInt(yearParam);
            const targetWeek = parseInt(weekParam);
            console.log(`从URL参数获取年份和周数: ${targetYear}年第${targetWeek}周`);
            setYear(targetYear);
            setWeekNumber(targetWeek);
            // 重新加载该周的报告数据
            await fetchExistingReport(targetYear, targetWeek, true);
          } else {
            // 检查当前选择的年份和周数是否已存在报告
            await fetchExistingReport(year, weekNumber);
          }

          urlParamsCheckedRef.current = true;
        } catch (error) {
          console.error('检查URL参数时出错', error);
        }
      };

      checkUrlParams();
    }
  }, [user]);

  // 添加页面可见性监听
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('项目周报编辑页面恢复可见');

          // 不再自动刷新数据
          console.log('保持现有数据，不自动刷新');

          // 仅在必要时检查URL参数（避免频繁重新加载周报内容）
          if (!urlParamsCheckedRef.current) {
            setTimeout(async () => {
              try {
                // 检查URL参数中是否有年份和周数
                const urlParams = new URLSearchParams(window.location.search);
                const yearParam = urlParams.get('year');
                const weekParam = urlParams.get('week');

                if (yearParam && weekParam) {
                  const targetYear = parseInt(yearParam);
                  const targetWeek = parseInt(weekParam);
                  console.log(`从URL参数获取年份和周数: ${targetYear}年第${targetWeek}周`);
                  setYear(targetYear);
                  setWeekNumber(targetWeek);
                  // 重新加载该周的报告数据
                  await fetchExistingReport(targetYear, targetWeek, true);
                } else {
                  // 检查当前选择的年份和周数是否已存在报告
                  await fetchExistingReport(year, weekNumber);
                }

                urlParamsCheckedRef.current = true;
                console.log('URL参数已检查');
              } catch (error) {
                console.error('检查URL参数时出错', error);
              }
            }, 100);
          }
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, []); // 移除所有依赖项

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回项目周报列表"
            render={<Link to="/dashboard/project-reports" />}
          >
            <ArrowLeftIcon data-icon="inline-start" />
          </Button>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">编辑项目周报</h1>
            <div className="flex flex-wrap gap-2">
              {reportId && (
                <Badge variant="secondary">
                  已有周报
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm"
            onClick={togglePreview}
          >
            <EyeIcon data-icon="inline-start" />
            {showPreview ? '返回编辑' : '预览'}
          </Button>
          <Button variant="outline" size="sm"
            type="button"
            onClick={saveDraft}
            disabled={isSavingDraft || isSavingReport || projects.length === 0}
          >
            {isSavingDraft ? (
              <>
                <Spinner data-icon="inline-start" />
                暂存中...
              </>
            ) : (
              <>
                <BookmarkIcon data-icon="inline-start" />
                暂存
              </>
            )}
          </Button>
          <Button size="sm"
            type="button"
            onClick={saveReport}
            disabled={isSavingDraft || isSavingReport || projects.length === 0}
          >
            {isSavingReport ? (
              <>
                <Spinner data-icon="inline-start" />
                保存中...
              </>
            ) : (
              <>
                <SaveIcon data-icon="inline-start" />
                保存周报
              </>
            )}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-6 md:p-12">
          <Spinner className="size-5" />
          <span className="text-sm text-muted-foreground md:text-base">加载中...</span>
        </div>
      ) : showPreview ? (
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>项目周报预览</CardTitle>
                <CardDescription>查看格式化后的周报内容</CardDescription>
              </div>

              {/* 控制按钮区域 */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 显示控制开关 */}
                <PreviewToggles
                  showWorkItems={showWorkItems}
                  showHierarchy={showHierarchy}
                  onChange={(nextShowWorkItems, nextShowHierarchy) => {
                    setShowWorkItems(nextShowWorkItems);
                    setShowHierarchy(nextShowHierarchy);
                  }}
                />

                {/* 复制按钮 */}
                <Button variant="outline" size="sm"
                  onClick={handleCopyMarkdown}
                  title="复制为Markdown格式"
                >
                  <CopyIcon data-icon="inline-start" />MD
                </Button>

                <Button variant="outline" size="sm"
                  onClick={handleCopyYaml}
                  title="复制为YAML格式"
                >
                  <CopyIcon data-icon="inline-start" />YML
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <CalendarIcon className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium sm:text-base">{year}年第{weekNumber}周 ({formattedPeriod})</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={reportId ? "default" : "outline"}>
                  {reportId ? '已保存' : '未保存'}
                </Badge>
              </div>
            </div>
            <Separator />

            {(() => {
              const previewContent = generatePreviewContent();
              return previewContent && previewContent.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {previewContent.map((projectData: any) => (
                    <Card key={projectData.project.id} className="bg-accent/40">
                      <CardHeader>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <CardTitle>{projectData.project.name}</CardTitle>
                          <CardDescription>({projectData.project.code})</CardDescription>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        {showWorkItems ? (
                          <>
                            {/* 显示工作项分组 */}
                            {showHierarchy && projectData.workItemsHierarchy.length > 0 ? (
                              // 层级模式
                              projectData.workItemsHierarchy.map((hierarchyItem: any) => (
                                <div key={hierarchyItem.id} className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
                                  <div className="mb-2 text-sm font-medium text-primary">
                                    {hierarchyItem.fullPath}
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    {hierarchyItem.items.map((item: any, index: number) => (
                                      <div key={index} className="text-sm">
                                        {index + 1}. {item.content}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))
                            ) : (
                              // 简单模式
                              Object.values(projectData.workItems).map((workItemData: any) => (
                                <div key={workItemData.workItem.id} className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
                                  <div className="mb-2 text-sm font-medium text-primary">
                                    {workItemData.workItem.name}
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    {workItemData.items.map((item: any, index: number) => (
                                      <div key={index} className="text-sm">
                                        {index + 1}. {item.content}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))
                            )}

                            {/* 其他工作（未选择工作项的内容）- 显示工作项时单独显示 */}
                            {projectData.directItems.length > 0 && (
                              <div className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
                                <div className="mb-2 text-sm font-medium text-primary">
                                  其他工作
                                </div>
                                <div className="flex flex-col gap-1">
                                  {projectData.directItems.map((item: any, index: number) => (
                                    <div key={index} className="text-sm">
                                      {index + 1}. {item.content}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          // 隐藏工作项时：显示所有内容的简化视图
                          <div className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
                            <div className="flex flex-col gap-1">
                              {projectData.items.map((item: any, index: number) => (
                                <div key={index} className="text-sm">
                                  {index + 1}. {item.content}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>预览将在此处显示</EmptyTitle>
                    <EmptyDescription>请先添加工作项内容</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              );
            })()}
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); saveReport(); }} className="flex flex-col gap-6">
          {/* 周报基本信息 */}
          <Card>
            <CardContent>
              <div className="grid gap-4 sm:gap-6">
                <div className="flex flex-col gap-2">
                  <Field>
                    <FieldLabel>
                      周报时间
                    </FieldLabel>
                    <div className="flex items-center gap-3">
                    <div className="flex flex-1 items-center gap-2 rounded-lg bg-accent px-3 py-2.5">
                      <CalendarIcon className="size-4 text-primary" />
                      <div className="text-sm font-medium text-primary">
                        {year}年第{weekNumber}周 ({formattedPeriod})
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger render={<button type="button"
                        onClick={goToPreviousWeek}
                        aria-label="上一周"
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
                      >
                        <ChevronLeftIcon data-icon="inline-start" />
                      </button>} />
                        <TooltipContent>上一周</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger render={<button type="button"
                        onClick={goToNextWeek}
                        aria-label="下一周"
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
                      >
                        <ChevronRightIcon data-icon="inline-start" />
                      </button>} />
                        <TooltipContent>下一周</TooltipContent>
                      </Tooltip>
                    </div>
                    </div>
                    <FieldError errors={[]} />
                  </Field>
                  </div>
                  {reportId && (
                    <div className="flex items-center">
                      <Badge variant="secondary">
                        已有周报
                      </Badge>
                      <span className="ml-2 text-xs text-muted-foreground sm:text-sm">
                        已加载该周的周报内容
                      </span>
                    </div>
                  )}
              </div>
            </CardContent>
          </Card>

          {/* 工作内容和预览区域 */}
          <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
            {/* 工作内容区域 */}
            <div className="w-full lg:w-2/3">
              <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-800 flex items-center">
                <FileTextIcon data-icon="inline-start" />项目工作内容
              </h3>
              <div className="flex flex-col gap-3 sm:gap-4 mb-4">
                {/* 添加新项目工作 */}
                {projects && projects.length > 0 && (
                  <Card>
                    <CardContent>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm text-gray-700">添加新项目工作</h4>
                    </div>
                    <div className="flex items-end gap-2">
                      <Field className="grow">
                        <FieldLabel htmlFor="new-project-select">选择项目</FieldLabel>
                        <Select value={selectedProjectId || "__none"} onValueChange={(value: string | null) => setSelectedProjectId(value === null || value === "__none" ? "" : value)} items={[{ label: '选择项目...', value: '__none' }, ...availableProjects.map((project) => ({ label: `${project.name} (${project.code})`, value: project.id }))]}>
                          <SelectTrigger id="new-project-select" className="w-full">
                            <SelectValue placeholder="选择项目..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="__none">选择项目...</SelectItem>
                              {availableProjects.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  {project.name} ({project.code})
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldError errors={[]} />
                      </Field>
                      <Button variant="outline" size="sm"
                        type="button"
                        onClick={addWorkItem}
                        disabled={!selectedProjectId}
                        className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-blue-50 text-blue-700 rounded-md border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center text-xs sm:text-sm transition-colors"
                      >
                        <PlusIcon data-icon="inline-start" /> 添加
                      </Button>
                    </div>
                    </CardContent>
                  </Card>
                )}

                {/* 按项目分组的工作项 */}
                {workItemsGroupedByProject.map((group, groupIndex) => (
                  <Card key={groupIndex}>
                    <CardContent>
                    <div className="flex justify-between items-center mb-2 sm:mb-3">
                      <h4 className="font-medium text-sm text-blue-600">{group.projectName}</h4>
                      <Button variant="outline" size="sm"
                        type="button"
                        onClick={() => handleAddWorkItem(group.projectId)}
                        className="text-blue-600 hover:text-blue-800 text-xs sm:text-sm font-medium flex items-center transition-colors"
                      >
                        <PlusIcon data-icon="inline-start" /> 添加工作项
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2 sm:gap-3">
                      {group.items.map((item, itemIndex) => (
                        <div key={item.tempId} className="flex items-start gap-2 sm:gap-3">
                          <div className="grow flex flex-col gap-2">
                            {/* 工作项分类选择 */}
                            <Field>
                              <FieldLabel htmlFor={`work-item-category-${item.tempId}`}>
                                工作项分类（可选）
                              </FieldLabel>
                              <WorkItemSelector
                                id={`work-item-category-${item.tempId}`}
                                projectId={group.projectId}
                                items={workBreakdownItems[group.projectId] || []}
                                selectedWorkItemId={item.workItemId}
                                onChange={(value: string) => {
                                  if (item.globalIndex !== -1) {
                                    updateWorkItem(item.globalIndex, 'workItemId', value);
                                  }
                                }}
                                onLoadRequest={fetchWorkBreakdownItems}
                              />
                              <FieldError errors={[]} />
                            </Field>

                            {/* 工作内容输入 */}
                            <Field>
                              <FieldLabel htmlFor={`work-item-content-${item.tempId}`}>
                                工作内容 <span className="text-destructive">*</span>
                              </FieldLabel>
                              <Textarea
                                id={`work-item-content-${item.tempId}`}
                                value={item.content}
                                onChange={(e) => {
                                  if (item.globalIndex !== -1) {
                                    updateWorkItem(item.globalIndex, 'content', e.target.value);
                                  }
                                }}
                                rows={2}
                                placeholder="请输入工作内容..."
                              />
                              <FieldError errors={[]} />
                            </Field>
                          </div>
                          <Tooltip>
                            <TooltipTrigger render={<button type="button"
                            onClick={() => {
                              if (item.globalIndex !== -1) {
                                removeWorkItem(item.globalIndex);
                              }
                            }}
                            aria-label="删除工作项"
                            className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
                          >
                            <TrashIcon data-icon="inline-start" />
                          </button>} />
                            <TooltipContent>删除工作项</TooltipContent>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* 实时预览面板 */}
            <div className="w-full lg:w-1/3">
              <div className="sticky top-4">
                <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-800 flex items-center">
                  <EyeIcon data-icon="inline-start" />实时预览
                </h3>
                <Card>
                  <CardContent>
                  <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
                    <div className="text-sm font-medium text-gray-700">
                      {year}年第{weekNumber}周
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm"
                        type="button"
                        onClick={handleCopyMarkdown}
                        className="inline-flex items-center px-1 py-0.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        title="复制为Markdown格式"
                      >
                        <CopyIcon data-icon="inline-start" />MD
                      </Button>
                      <Button variant="outline" size="sm"
                        type="button"
                        onClick={handleCopyYaml}
                        className="inline-flex items-center px-1 py-0.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        title="复制为YAML格式"
                      >
                        <CopyIcon data-icon="inline-start" />YML
                      </Button>
                    </div>
                  </div>

                  {/* 控制按钮区域 */}
                  <div className="flex flex-wrap items-center gap-1 mb-3 pb-2 border-b border-gray-100">
                    <Button variant="outline" size="sm"
                      type="button"
                      onClick={() => setShowWorkItems(!showWorkItems)}
                      className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-md border ${
                        showWorkItems
                          ? 'bg-blue-50 text-blue-700 border-blue-300'
                          : 'bg-gray-50 text-gray-700 border-gray-300'
                      }`}
                      title={showWorkItems ? '隐藏工作项' : '显示工作项'}
                    >
                      {showWorkItems ? <EyeIcon data-icon="inline-start" /> : <EyeOffIcon data-icon="inline-start" />}
                      工作项
                    </Button>
                    {showWorkItems && (
                      <Button variant="outline" size="sm"
                        type="button"
                        onClick={() => setShowHierarchy(!showHierarchy)}
                        className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-md border ${
                          showHierarchy
                            ? 'bg-green-50 text-green-700 border-green-300'
                            : 'bg-gray-50 text-gray-700 border-gray-300'
                        }`}
                        title={showHierarchy ? '隐藏层级' : '显示层级'}
                      >
                        层级
                      </Button>
                    )}
                  </div>

                  {(() => {
                    const previewContent = generatePreviewContent();
                    return previewContent && previewContent.length > 0 ? (
                      <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                        {previewContent.map((projectData: any) => (
                          <div key={projectData.project.id} className="bg-blue-50 border border-blue-200 rounded p-2">
                            {/* 项目标题 */}
                            <div className="text-xs font-medium text-blue-700 mb-2 pb-1 border-b border-blue-200">
                              {projectData.project.name}
                            </div>

                            {/* 工作内容 */}
                            <div className="flex flex-col gap-2">
                              {showWorkItems ? (
                                <>
                                  {/* 显示工作项分组 */}
                                  {showHierarchy && projectData.workItemsHierarchy.length > 0 ? (
                                    // 层级模式
                                    projectData.workItemsHierarchy.map((hierarchyItem: any) => (
                                      <div key={hierarchyItem.id} className="bg-white border border-blue-100 rounded p-2">
                                        <div className="text-xs font-medium text-blue-600 mb-1">
                                          {hierarchyItem.fullPath}
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          {hierarchyItem.items.map((item: any, index: number) => (
                                            <div key={index} className="text-xs text-gray-700">
                                              {index + 1}. {item.content}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    // 简单模式
                                    Object.values(projectData.workItems).map((workItemData: any) => (
                                      <div key={workItemData.workItem.id} className="bg-white border border-blue-100 rounded p-2">
                                        <div className="text-xs font-medium text-blue-600 mb-1">
                                          {workItemData.workItem.name}
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          {workItemData.items.map((item: any, index: number) => (
                                            <div key={index} className="text-xs text-gray-700">
                                              {index + 1}. {item.content}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))
                                  )}

                                  {/* 其他工作（未选择工作项的内容）- 显示工作项时单独显示 */}
                                  {projectData.directItems.length > 0 && (
                                    <div className="bg-white border border-blue-100 rounded p-2">
                                      <div className="text-xs font-medium text-blue-600 mb-1">
                                        其他工作
                                      </div>
                                      <div className="flex flex-col gap-0.5">
                                        {projectData.directItems.map((item: any, index: number) => (
                                          <div key={index} className="text-xs text-gray-700">
                                            {index + 1}. {item.content}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                // 隐藏工作项时：显示所有内容的简化视图
                                <div className="bg-white border border-blue-100 rounded p-2">
                                  <div className="flex flex-col gap-0.5">
                                    {projectData.items.map((item: any, index: number) => (
                                      <div key={index} className="text-xs text-gray-700">
                                        {index + 1}. {item.content}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty>
                        <EmptyHeader>
                          <EmptyTitle>预览将在此处显示</EmptyTitle>
                          <EmptyDescription>请先添加工作项内容</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    );
                  })()}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
