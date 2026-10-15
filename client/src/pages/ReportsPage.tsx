
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { DownloadIcon, FileTextIcon, RefreshCwIcon, CheckCircleIcon, XCircleIcon, AlertCircleIcon, EyeIcon, CopyIcon, XIcon, PencilIcon, SparklesIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useAuth } from "../contexts/auth-context";
import { apiGet, apiPost } from "../lib/api";
import type { UserAISettings } from "../lib/db/types";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, getWeek, getMonth, getYear, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { zhCN } from "date-fns/locale";
import { toast } from "@/components/ui/toast";
import { usePersistentState } from "../lib/utils/page-persistence";
import { getWorkStatusStyle } from "../lib/utils/status-colors";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Empty, EmptyHeader, EmptyTitle, EmptyMedia } from "@/components/ui/empty";


interface DailyReportData {
  date: string;
  content?: string;
}

type ReportType = "weekly" | "monthly";
type ReportStatus = "generated" | "pending" | "generating" | "not_available";

interface DailyReportStatus {
  date: string; // ISO格式日期
  hasReport: boolean;
}

interface WeekData {
  weekNumber: number;
  year: number;
  startDate: Date;
  endDate: Date;
  formattedPeriod: string;
  reportStatus: ReportStatus;
  dailyReportStatus: DailyReportStatus[];
  generatedAt?: string;
  reportContent?: string;
}

interface MonthData {
  month: number;
  year: number;
  startDate: Date;
  endDate: Date;
  formattedPeriod: string;
  reportStatus: ReportStatus;
  dailyReportStatus: DailyReportStatus[];
  generatedAt?: string;
  reportContent?: string;
}

interface ReportPreviewProps {
  title: string;
  content: string;
  onClose: () => void;
  onSave?: (content: string) => Promise<void>;
}

// 日报状态色块的布局参数（周报、月报各有差异）
interface DailyStatusBlockOptions {
  containerClassName: string;
  blockClassName: string;
  keyWithDate?: boolean;
}

// 周报：每天一个色块，横向排列
const WEEKLY_STATUS_BLOCKS: DailyStatusBlockOptions = {
  containerClassName: "flex gap-1",
  blockClassName: "size-3",
};

// 报告预览组件
const ReportPreview: React.FC<ReportPreviewProps> = ({ title, content, onClose, onSave }) => {
  const { user } = useAuth();
  const textareaWrapRef = useRef<HTMLDivElement>(null);
  const [editedContent, setEditedContent] = useState(content);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [aiSettings, setAiSettings] = useState<UserAISettings | null>(null);
  
  // 加载用户AI设置
  useEffect(() => {
    const loadAISettings = async () => {
      if (!user) return;

      try {
        const data = await apiGet<{ settings: UserAISettings }>('/api/ai-settings');
        if (data.settings) {
          setAiSettings(data.settings);
        }
      } catch (error) {
        console.error("加载AI设置时出错:", error);
      }
    };

    loadAISettings();
  }, [user]);
  
  // 检查AI功能是否启用
  const isAIEnabled = useMemo(() => {
    return aiSettings?.is_enabled === true;
  }, [aiSettings]);
  
  const handleCopy = () => {
    // ui Textarea 无 forwardRef，ref 挂在包裹容器上，通过容器取到原生 textarea
    const textarea = textareaWrapRef.current?.querySelector('textarea');
    if (textarea) {
      textarea.select();
      document.execCommand('copy');
      toast.add({ title: '内容已复制到剪贴板', type: 'success' });
    }
  };
  
  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([editedContent], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `${title.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.add({ title: '报告已下载', type: 'success' });
  };

  const handleEdit = () => {
    setIsEditing(true);
  };
  
  const handleSave = async () => {
    if (!onSave) return;
    
    setIsSaving(true);
    try {
      await onSave(editedContent);
      toast.add({ title: '报告已保存', type: 'success' });
      setIsEditing(false);
    } catch (error) {
      console.error('保存报告失败:', error);
      toast.add({ title: '保存失败，请重试', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleCancel = () => {
    setEditedContent(content);
    setIsEditing(false);
  };
  
  // AI润色功能
  const handlePolish = async () => {
    if (!aiSettings) {
      toast.add({ title: '未找到AI设置，请先在设置页面配置AI', type: 'error' });
      return;
    }
    
    // 使用用户自定义AI配置
    if (!aiSettings.api_key) {
      toast.add({ title: '未设置API密钥，请先在设置页面配置', type: 'error' });
      return;
    }
    const apiConfig = {
      api_url: aiSettings.api_url,
      api_key: aiSettings.api_key,
      model_name: aiSettings.model_name,
      system_prompt: aiSettings.system_prompt,
      user_prompt: aiSettings.user_prompt,
    };
    
    setIsPolishing(true);
    toast.add({ title: '正在使用自定义AI润色报告...', type: 'info' });
    
    try {
      // 准备提示词
      const reportType = title.includes('周报') ? '周报' : '月报';
      const systemPrompt = apiConfig.system_prompt || '你是一个专业的工作报告助手，负责帮助用户整理和生成日报、周报和月报。';
      
      // 替换用户提示词中的占位符
      let userPrompt = apiConfig.user_prompt || '请根据我的工作内容，生成一份专业的{report_type}。以下是我的工作记录：\n\n{report_content}';
      userPrompt = userPrompt
        .replace('{report_type}', reportType)
        .replace('{report_content}', editedContent);
      
      // 添加润色指令
      userPrompt = `请对以下${reportType}进行润色和优化，使其更加专业、条理清晰，并保持原有的工作内容不变。\n\n${editedContent}`;
      
      // 调用AI API（通过代理路由绕过CORS）
      const result = await apiPost<{ choices?: Array<{ message?: { content?: string } }> }>('/api/ai', {
        api_url: apiConfig.api_url || 'https://api.openai.com/v1',
        api_key: apiConfig.api_key,
        model: apiConfig.model_name || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      });

      const polishedContent = result.choices?.[0]?.message?.content;
      
      if (polishedContent) {
        setEditedContent(polishedContent);
        toast.add({ title: 'AI润色完成', type: 'success' });
        // 自动进入编辑模式以便用户可以进一步修改
        setIsEditing(true);
      } else {
        throw new Error('未收到有效的AI响应');
      }
    } catch (error: unknown) {
      console.error('AI润色失败:', error);
      toast.add({ title: `润色失败: ${error instanceof Error ? error.message : '未知错误'}`, type: 'error' });
    } finally {
      setIsPolishing(false);
    }
  };
  
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate pr-2">{title}</DialogTitle>
          <DialogDescription>预览、编辑、润色并保存报告内容</DialogDescription>
        </DialogHeader>
        
        <div ref={textareaWrapRef} className="min-h-0 grow overflow-auto p-1">
          <Field>
            <FieldLabel htmlFor="report-content" className="sr-only">报告内容</FieldLabel>
            <Textarea
              id="report-content"
              className={cn(
                "h-full min-h-50 p-2 font-mono text-xs md:min-h-100 md:p-4 md:text-sm",
                isEditing ? "bg-card" : "bg-muted/50"
              )}
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              readOnly={!isEditing}
            />
            <FieldError errors={[]} />
          </Field>
        </div>
        
        <DialogFooter className="flex-wrap justify-end">
          <Button variant="outline" size="sm"
            onClick={handleCopy}
          >
            <CopyIcon data-icon="inline-start" />
            复制
          </Button>
          <Button variant="outline" size="sm"
            onClick={handleDownload}
          >
            <DownloadIcon data-icon="inline-start" />
            下载
          </Button>
          
          {isAIEnabled && (
            <Button variant="outline" size="sm"
              onClick={handlePolish}
              disabled={isPolishing || isEditing}
              className="text-chart-4"
              title="使用AI润色报告"
            >
              <SparklesIcon data-icon="inline-start" className={isPolishing ? "animate-pulse" : undefined} />
              {isPolishing ? '润色中...' : 'AI润色'}
            </Button>
          )}

          {isEditing ? (
              <>
                <Button variant="outline" size="sm"
                  onClick={handleCancel}
                >
                  <XIcon data-icon="inline-start" />
                  取消
                </Button>
                <Button size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving && <Spinner data-icon="inline-start" />}
                  {!isSaving && <CheckCircleIcon data-icon="inline-start" />}
                  保存
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm"
                onClick={handleEdit}
                className="text-primary"
              >
                <PencilIcon data-icon="inline-start" />
                编辑
              </Button>
            )}
          
          <Button size="sm"
            onClick={onClose}
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// 周期切换组件（周报按月切换、月报按年切换共用）
interface BreadcrumbsProps {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
}

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ label, prevLabel, nextLabel, onPrev, onNext }) => {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground md:text-sm">
      <Tooltip>
<TooltipTrigger render={<button type="button"
        onClick={onPrev}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
        aria-label={prevLabel}
      >
        <ChevronLeftIcon />
      </button>} />
<TooltipContent>{prevLabel}</TooltipContent>
</Tooltip>
      <span className="font-medium whitespace-nowrap text-foreground">{label}</span>
      <Tooltip>
<TooltipTrigger render={<button type="button"
        onClick={onNext}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
        aria-label={nextLabel}
      >
        <ChevronRightIcon />
      </button>} />
<TooltipContent>{nextLabel}</TooltipContent>
</Tooltip>
    </div>
  );
};

export default function ReportsPage() {
  const { user } = useAuth();
  
  // 替换普通状态为持久化状态
  const [activeTab, setActiveTab] = usePersistentState<ReportType>("reports-active-tab", "weekly");
  const [isLoading, setIsLoading] = useState(true);
  const [generatingReportId, setGeneratingReportId] = usePersistentState<string | null>("reports-generating-id", null);
  const [weeklyData, setWeeklyData] = usePersistentState<WeekData[]>("reports-weekly-data", []);
  const [monthlyData, setMonthlyData] = usePersistentState<MonthData[]>("reports-monthly-data", []);
  const [dailyReports, setDailyReports] = usePersistentState<DailyReportData[]>("reports-daily-reports", []);
  const [previewData, setPreviewData] = usePersistentState<{
    title: string;
    content: string;
    type: ReportType;
    period: string;
  } | null>("reports-preview-data", null);
  
  // 分页控制 - 持久化
  const [currentYear, setCurrentYear] = usePersistentState<number>("reports-current-year", new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = usePersistentState<number>("reports-current-month", new Date().getMonth() + 1);

  // 添加数据加载状态引用
  const dataLoadedRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);
  // 数据刷新间隔（毫秒），设置为5分钟
  const DATA_REFRESH_INTERVAL = 5 * 60 * 1000;

  // 按年月筛选的周报数据
  const filteredWeeklyData = useMemo(() => {
    return weeklyData.filter(week => {
      // 确保日期是Date对象
      const startDate = week.startDate instanceof Date ? week.startDate : new Date(week.startDate);
      const endDate = week.endDate instanceof Date ? week.endDate : new Date(week.endDate);
      
      // 获取周起始日期所在的月份
      const weekStartMonth = startDate.getMonth() + 1;
      const weekStartYear = startDate.getFullYear();
      
      // 获取周结束日期所在的月份
      const weekEndMonth = endDate.getMonth() + 1;
      const weekEndYear = endDate.getFullYear();
      
      // 如果周跨月，只要有一部分在当前选择的月份就显示
      return (
        (weekStartYear === currentYear && weekStartMonth === currentMonth) ||
        (weekEndYear === currentYear && weekEndMonth === currentMonth)
      );
    });
  }, [weeklyData, currentYear, currentMonth]);
  
  // 按年筛选的月报数据
  const filteredMonthlyData = useMemo(() => {
    return monthlyData.filter(month => {
      // 确保日期是Date对象
      const startDate = month.startDate instanceof Date ? month.startDate : new Date(month.startDate);
      return startDate.getFullYear() === currentYear;
    });
  }, [monthlyData, currentYear]);

  // 处理数据恢复，确保日期字段正确转换为Date对象
  useEffect(() => {
    if (weeklyData.length > 0) {
      const processedWeeklyData = weeklyData.map(week => ({
        ...week,
        startDate: week.startDate instanceof Date ? week.startDate : new Date(week.startDate),
        endDate: week.endDate instanceof Date ? week.endDate : new Date(week.endDate)
      }));
      
      // 只有当数据需要转换时才更新
      if (processedWeeklyData.some((week, index) => 
        !(weeklyData[index].startDate instanceof Date) || 
        !(weeklyData[index].endDate instanceof Date))) {
        setWeeklyData(processedWeeklyData);
      }
    }
    
    if (monthlyData.length > 0) {
      const processedMonthlyData = monthlyData.map(month => ({
        ...month,
        startDate: month.startDate instanceof Date ? month.startDate : new Date(month.startDate),
        endDate: month.endDate instanceof Date ? month.endDate : new Date(month.endDate)
      }));
      
      // 只有当数据需要转换时才更新
      if (processedMonthlyData.some((month, index) => 
        !(monthlyData[index].startDate instanceof Date) || 
        !(monthlyData[index].endDate instanceof Date))) {
        setMonthlyData(processedMonthlyData);
      }
    }
  }, [weeklyData, monthlyData, setWeeklyData, setMonthlyData]);

  // 处理年月切换 - 使用useCallback包装
  const handleYearMonthChange = useCallback((year: number, month: number) => {
    // 处理月份溢出
    if (month < 1) {
      setCurrentYear(year - 1);
      setCurrentMonth(12);
    } else if (month > 12) {
      setCurrentYear(year + 1);
      setCurrentMonth(1);
    } else {
      setCurrentYear(year);
      setCurrentMonth(month);
    }
  }, [setCurrentYear, setCurrentMonth]);

  // 处理年份切换（用于月报）- 使用useCallback包装
  const handleYearChange = useCallback((year: number) => {
    setCurrentYear(year);
  }, [setCurrentYear]);

  // 生成周报数据 - 使用useCallback包装
  const generateWeeklyData = useCallback((reports: DailyReportData[]) => {
    const today = new Date();
    const weeks: WeekData[] = [];
    
    // 生成最近12周的数据
    for (let i = 0; i < 12; i++) {
      const currentWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * 7);
      const weekStartDate = startOfWeek(currentWeek, { locale: zhCN });
      const weekEndDate = endOfWeek(weekStartDate, { locale: zhCN });
      const weekNumber = getWeek(weekStartDate, { locale: zhCN });
      const year = getYear(weekStartDate);
      
      // 获取这一周的日报状态
      const dailyStatus: DailyReportStatus[] = [];
      
      // 生成周期内每天的日报状态
      eachDayOfInterval({ start: weekStartDate, end: weekEndDate }).forEach(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const report = reports.find(r => r.date === dateStr);

        dailyStatus.push({
          date: dateStr,
          hasReport: !!report
        });
      });
      
      weeks.push({
        weekNumber,
        year,
        startDate: weekStartDate,
        endDate: weekEndDate,
        formattedPeriod: `${format(weekStartDate, 'yyyy-MM-dd')} 至 ${format(weekEndDate, 'yyyy-MM-dd')}`,
        reportStatus: 'pending',
        dailyReportStatus: dailyStatus,
      });
    }
    
    setWeeklyData(weeks);
  }, [setWeeklyData]);

  // 生成月报数据 - 使用useCallback包装
  const generateMonthlyData = useCallback((reports: DailyReportData[]) => {
    const today = new Date();
    const months: MonthData[] = [];
    
    // 生成最近24个月的数据，确保有更多历史数据
    for (let i = 0; i < 24; i++) {
      const currentMonth = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthStartDate = startOfMonth(currentMonth);
      const monthEndDate = endOfMonth(currentMonth);
      const month = getMonth(monthStartDate);
      const year = getYear(monthStartDate);
      
      // 获取这个月每天的日报状态和内容
      const dailyStatus: DailyReportStatus[] = [];
      const monthlyReportsByProject: Record<string, {projectName: string, projectCode: string, items: {date: string, content: string}[]}> = {};
      
      // 按日期降序排序这个月的日期
      const monthDates = eachDayOfInterval({ start: monthStartDate, end: monthEndDate })
        .sort((a, b) => a.getTime() - b.getTime());
      
      monthDates.forEach(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const reportForDate = reports.find(report => {
          const reportDate = format(parseISO(report.date), 'yyyy-MM-dd');
          return reportDate === dateStr;
        });
        
        const hasReport = !!reportForDate;

        dailyStatus.push({ date: dateStr, hasReport });

        // 日报参与月报生成
        if (hasReport && reportForDate?.content) {
          // 解析内容，按项目分组
          const contentLines = reportForDate.content.split('\n');
          contentLines.forEach(line => {
            // 匹配 [项目名称 (项目编号)] 内容
            const match = line.match(/\[(.*?) \((.*?)\)\] (.*)/);
            if (match) {
              const projectName = match[1];
              const projectCode = match[2];
              const content = match[3];
              const projectKey = `${projectName}-${projectCode}`;
              
              if (!monthlyReportsByProject[projectKey]) {
                monthlyReportsByProject[projectKey] = {
                  projectName,
                  projectCode,
                  items: []
                };
              }
              
              monthlyReportsByProject[projectKey].items.push({
                date: dateStr,
                content
              });
            }
          });
        }
      });
      
      // 计算填报完整度
      const filledDays = dailyStatus.filter(day => day.hasReport).length;
      const totalWorkDays = dailyStatus.length;
      const completionRate = filledDays / totalWorkDays;
      
      // 确定报告状态
      let reportStatus: ReportStatus = "not_available";
      if (completionRate >= 0.5) {
        reportStatus = "pending"; // 一半以上工作日有日报，可以生成
      } else if (completionRate > 0) {
        reportStatus = "pending"; // 部分工作日有日报，可以生成但不完整
      }
      
      // 生成月报内容
      let reportContent = '';
      
      // 添加项目分组内容
      Object.values(monthlyReportsByProject).forEach(project => {
        reportContent += `${project.projectName}\n`;
        
        // 项目下的工作内容
        project.items.forEach(item => {
          reportContent += `- ${item.date}: ${item.content}\n`;
        });
        
        reportContent += '\n';
      });
      
      months.push({
        month: month + 1,
        year,
        startDate: monthStartDate,
        endDate: monthEndDate,
        formattedPeriod: format(monthStartDate, 'yyyy年MM月'),
        reportStatus,
        dailyReportStatus: dailyStatus,
        reportContent: reportContent.trim()
      });
    }
    
    setMonthlyData(months);
  }, [setMonthlyData]);

  // 获取已保存的周报 - 使用useCallback包装
  const fetchSavedWeeklyReports = useCallback(async () => {
    if (!user) return;

    try {
      const data = await apiGet<{ reports: any[] }>('/api/weekly-reports');

      if (data.reports && data.reports.length > 0) {
        // 更新周报数据
        setWeeklyData(prevData => {
          const updatedData = [...prevData];

          data.reports.forEach((report: any) => {
            const index = updatedData.findIndex(
              week => week.year === report.year && week.weekNumber === report.week_number
            );
            
            if (index !== -1) {
              updatedData[index].reportStatus = 'generated';
              updatedData[index].reportContent = report.content as string;
              updatedData[index].generatedAt = format(new Date(report.updated_at as string), 'yyyy-MM-dd HH:mm:ss');
            }
          });
          
          return updatedData;
        });
      }
    } catch (error) {
      console.error('获取周报数据失败', error);
    }
  }, [user, setWeeklyData]);

  // 获取已保存的月报 - 使用useCallback包装
  const fetchSavedMonthlyReports = useCallback(async () => {
    if (!user) return;

    try {
      const data = await apiGet<{ reports: any[] }>('/api/monthly-reports');

      if (data.reports && data.reports.length > 0) {
        // 更新月报数据
        setMonthlyData(prevData => {
          const updatedData = [...prevData];

          data.reports.forEach((report: any) => {
            const index = updatedData.findIndex(
              month => month.year === report.year && month.month === report.month
            );
            
            if (index !== -1) {
              updatedData[index].reportStatus = 'generated';
              updatedData[index].reportContent = report.content as string;
              updatedData[index].generatedAt = format(new Date(report.updated_at as string), 'yyyy-MM-dd HH:mm:ss');
            }
          });
          
          return updatedData;
        });
      }
    } catch (error) {
      console.error('获取月报数据失败', error);
    }
  }, [user, setMonthlyData]);

  // 获取日报数据 - 使用useCallback包装
  const fetchDailyReports = useCallback(async () => {
    if (!user) return;
    
    // 检查是否已加载过数据
    if (dataLoadedRef.current && dailyReports.length > 0) {
      console.log('已有日报数据，跳过重新获取');
      setIsLoading(false);
      return;
    }
    
    // 检查是否超过刷新间隔
    const now = Date.now();
    const timeSinceLastLoad = now - lastLoadTimeRef.current;
    if (lastLoadTimeRef.current > 0 && timeSinceLastLoad < DATA_REFRESH_INTERVAL) {
      console.log(`数据加载间隔小于${DATA_REFRESH_INTERVAL/1000}秒，跳过重新获取`);
      setIsLoading(false);
      return;
    }
    
    console.log('加载日报数据');
    setIsLoading(true);
    try {
      const data = await apiGet<{ reports: any[] }>('/api/daily-reports?with_items=1');

      // 处理日报数据，添加内容字段
      const processedData = (data.reports || []).map((report: any) => {
        return {
          date: report.date as string,
          content: (report.report_items || []).map((item: any) => {
            const project = Array.isArray(item.projects) ? item.projects[0] : item.projects;
            return `[${project?.name} (${project?.code})] ${item.content}`;
          }).join('\n')
        };
      });

      setDailyReports(processedData);
      
      // 生成周报和月报数据
      generateWeeklyData(processedData);
      generateMonthlyData(processedData);
      
      // 加载已保存的周报和月报
      await Promise.all([
        fetchSavedWeeklyReports(),
        fetchSavedMonthlyReports()
      ]);
      
      // 更新加载状态和时间戳
      dataLoadedRef.current = true;
      lastLoadTimeRef.current = now;
    } catch (error) {
      console.error('获取日报数据失败', error);
      toast.add({ title: '获取日报数据失败', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [user, dailyReports.length, setDailyReports, generateWeeklyData, generateMonthlyData, fetchSavedWeeklyReports, fetchSavedMonthlyReports]);

  // 添加页面可见性监听
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('周报月报页面恢复可见，检查数据状态');
          
          // 检查是否需要重新加载数据
          const now = Date.now();
          const timeSinceLastLoad = now - lastLoadTimeRef.current;
          
          // 如果超过刷新间隔，重新加载数据
          if (timeSinceLastLoad > DATA_REFRESH_INTERVAL) {
            console.log('数据超过刷新间隔，重新加载');
            // 重置数据加载状态
            dataLoadedRef.current = false;
            fetchDailyReports();
          } else {
            console.log('数据在刷新间隔内，保持现有数据');
          }
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [fetchDailyReports]);

  // 初始加载数据
  useEffect(() => {
    if (user) {
      fetchDailyReports();
    }
  }, [user, fetchDailyReports]);

  // 处理报告生成
  const handleGenerateReport = async (type: ReportType, period: string) => {
    // 设置生成状态
    setGeneratingReportId(`${type}-${period}`);
    
    try {
      let content = '';
      
      if (type === 'weekly') {
        // 查找对应的周报数据
        const weekData = weeklyData.find(w => w.formattedPeriod === period);
        if (!weekData) throw new Error('未找到周报数据');
        
        // 收集该周的日报内容
        const dailyContents = dailyReports
          .filter(report => {
            const reportDate = parseISO(report.date);
            return reportDate >= weekData.startDate && reportDate <= weekData.endDate;
          })
          .map(report => {
            return {
              date: report.date,
              content: report.content || '无内容'
            };
          })
          .sort((a, b) => a.date.localeCompare(b.date));
        
        // 生成简化的周报内容
        content = '';
        
        // 按项目分组收集内容
        const projectGroups: Record<string, {projectName: string, items: {date: string, content: string}[]}> = {};
        
        dailyContents.forEach(day => {
          const contentLines = day.content.split('\n');
          contentLines.forEach(line => {
            // 匹配 [项目名称 (项目编号)] 内容
            const match = line.match(/\[(.*?) \((.*?)\)\] (.*)/);
            if (match) {
              const projectName = match[1];
              const projectKey = projectName;
              
              if (!projectGroups[projectKey]) {
                projectGroups[projectKey] = {
                  projectName,
                  items: []
                };
              }
              
              projectGroups[projectKey].items.push({
                date: day.date,
                content: match[3]
              });
            }
          });
        });
        
        // 生成YAML格式内容
        Object.values(projectGroups).forEach(project => {
          content += `${project.projectName}\n`;
          project.items.forEach(item => {
            content += `- ${item.date}: ${item.content}\n`;
          });
          content += '\n';
        });
        
        // 保存到数据库（服务端按 年+周 upsert）
        if (user) {
          await apiPost('/api/weekly-reports', {
            year: weekData.year,
            week_number: weekData.weekNumber,
            start_date: format(weekData.startDate, 'yyyy-MM-dd'),
            end_date: format(weekData.endDate, 'yyyy-MM-dd'),
            content,
            status: 'generated'
          });
        }
        
        // 更新状态
        setWeeklyData(prev => {
          return prev.map(w => {
            if (w.year === weekData.year && w.weekNumber === weekData.weekNumber) {
              return {
                ...w,
                reportStatus: 'generated',
                reportContent: content,
                generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
              };
            }
            return w;
          });
        });
      } else if (type === 'monthly') {
        // 查找对应的月报数据
        const monthData = monthlyData.find(m => m.formattedPeriod === period);
        if (!monthData) throw new Error('未找到月报数据');
        
        // 收集该月的日报内容
        const dailyContents = dailyReports
          .filter(report => {
            const reportDate = parseISO(report.date);
            return reportDate >= monthData.startDate && reportDate <= monthData.endDate;
          })
          .map(report => {
            return {
              date: report.date,
              content: report.content || '无内容'
            };
          })
          .sort((a, b) => a.date.localeCompare(b.date));
        
        // 生成简化的月报内容
        content = '';
        
        // 按项目分组收集内容
        const projectGroups: Record<string, {projectName: string, items: {date: string, content: string}[]}> = {};
        
        dailyContents.forEach(day => {
          const contentLines = day.content.split('\n');
          contentLines.forEach(line => {
            // 匹配 [项目名称 (项目编号)] 内容
            const match = line.match(/\[(.*?) \((.*?)\)\] (.*)/);
            if (match) {
              const projectName = match[1];
              const projectKey = projectName;
              
              if (!projectGroups[projectKey]) {
                projectGroups[projectKey] = {
                  projectName,
                  items: []
                };
              }
              
              projectGroups[projectKey].items.push({
                date: day.date,
                content: match[3]
              });
            }
          });
        });
        
        // 生成YAML格式内容
        Object.values(projectGroups).forEach(project => {
          content += `${project.projectName}\n`;
          project.items.forEach(item => {
            content += `- ${item.date}: ${item.content}\n`;
          });
          content += '\n';
        });
        
        // 保存到数据库（服务端按 年+月 upsert）
        if (user) {
          await apiPost('/api/monthly-reports', {
            year: monthData.year,
            month: monthData.month,
            start_date: format(monthData.startDate, 'yyyy-MM-dd'),
            end_date: format(monthData.endDate, 'yyyy-MM-dd'),
            content,
            status: 'generated'
          });
        }
        
        // 更新状态
        setMonthlyData(prev => {
          return prev.map(m => {
            if (m.year === monthData.year && m.month === monthData.month) {
              return {
                ...m,
                reportStatus: 'generated',
                reportContent: content,
                generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
              };
            }
            return m;
          });
        });
      }
      
      // 显示成功消息
      toast.add({ title: `${type === 'weekly' ? '周报' : '月报'}生成成功`, type: 'success' });
      
      // 移除自动打开预览
      // handlePreviewReport(type, period);
    } catch (error: any) {
      console.error('生成报告失败', error);
      toast.add({ title: `生成失败: ${error.message || '未知错误'}`, type: 'error' });
    } finally {
      setGeneratingReportId(null);
    }
  };

  // 处理预览报告
  const handlePreviewReport = (type: ReportType, period: string) => {
    if (type === 'weekly') {
      const week = weeklyData.find(w => w.formattedPeriod === period);
      if (week && week.reportContent) {
        setPreviewData({
          title: `周报`,
          content: week.reportContent,
          type: 'weekly',
          period: period
        });
      }
    } else {
      const month = monthlyData.find(m => m.formattedPeriod === period);
      if (month && month.reportContent) {
        setPreviewData({
          title: `月报`,
          content: month.reportContent,
          type: 'monthly',
          period: period
        });
      }
    }
  };

  // 保存编辑后的报告
  const handleSaveReport = async (content: string) => {
    if (!previewData || !user) return;
    
    try {
      if (previewData.type === 'weekly') {
        const week = weeklyData.find(w => w.formattedPeriod === previewData.period);
        if (!week) throw new Error('未找到对应周报');

        // 保存（服务端按 年+周 upsert）
        await apiPost('/api/weekly-reports', {
          year: week.year,
          week_number: week.weekNumber,
          start_date: format(week.startDate, 'yyyy-MM-dd'),
          end_date: format(week.endDate, 'yyyy-MM-dd'),
          content: content,
          status: 'generated'
        });

        // 更新本地数据
        setWeeklyData(prev => prev.map(w => 
          w.formattedPeriod === previewData.period 
            ? { 
                ...w, 
                reportContent: content,
                reportStatus: 'generated',
                generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
              } 
            : w
        ));
      } else {
        const month = monthlyData.find(m => m.formattedPeriod === previewData.period);
        if (!month) throw new Error('未找到对应月报');

        // 保存（服务端按 年+月 upsert）
        await apiPost('/api/monthly-reports', {
          year: month.year,
          month: month.month,
          start_date: format(month.startDate, 'yyyy-MM-dd'),
          end_date: format(month.endDate, 'yyyy-MM-dd'),
          content: content,
          status: 'generated'
        });

        // 更新本地数据
        setMonthlyData(prev => prev.map(m => 
          m.formattedPeriod === previewData.period 
            ? { 
                ...m, 
                reportContent: content,
                reportStatus: 'generated',
                generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
              } 
            : m
        ));
      }
    } catch (error) {
      console.error('保存报告失败:', error);
      throw error;
    }
  };

  // 关闭预览
  const handleClosePreview = () => {
    setPreviewData(null);
  };

  // 渲染日报状态色块（周报、月报共用）
  const renderDailyStatusIndicators = (dailyStatus: DailyReportStatus[], options: DailyStatusBlockOptions) => {
    return (
      <div className={options.containerClassName}>
        {dailyStatus.map((day, index) => {
          const date = parseISO(day.date);
          const dayOfWeek = date.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

          // 状态色统一由 lib/utils/status-colors 提供：已填报=已完成、未填报=未开始
          const statusStyle = getWorkStatusStyle(day.hasReport ? '已完成' : '未开始');

          // 设置提示文本
          const statusText = day.hasReport ? '已填报' : '未填报';

          return (
            <div
              key={options.keyWithDate ? `${day.date}-${index}` : index}
              className={cn('rounded-sm', options.blockClassName, statusStyle.solidClassName, isWeekend && 'opacity-60')}
              title={`${day.date}${isWeekend ? ' (周末)' : ''}: ${statusText}`}
            />
          );
        })}
      </div>
    );
  };

  // 渲染报告状态
  const renderReportStatus = (status: ReportStatus) => {
    switch (status) {
      case 'generated':
        return (
          <Badge variant="default">
            <CheckCircleIcon data-icon="inline-start" />
            已生成
          </Badge>
        );
      case 'generating':
        return (
          <Badge variant="secondary">
            <Spinner data-icon="inline-start" />
            生成中
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="secondary">
            <AlertCircleIcon data-icon="inline-start" />
            可生成
          </Badge>
        );
      case 'not_available':
        return (
          <Badge variant="outline">
            <XCircleIcon data-icon="inline-start" />
            无法生成
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl md:text-2xl font-bold">周报月报</h1>
      </div>

      {/* 切换标签 */}
      <Tabs value={activeTab} onValueChange={(value) => { if (value === "weekly" || value === "monthly") setActiveTab(value); }}>
        <TabsList variant="line">
          <TabsTrigger value="weekly">周报</TabsTrigger>
          <TabsTrigger value="monthly">月报</TabsTrigger>
        </TabsList>

      {/* 报告列表 */}
      <TabsContent value={activeTab}>
      <Card>
        <CardHeader className="border-b border-gray-200">
          <div className="flex justify-between items-center">
            <CardTitle>
            {activeTab === "weekly" ? "周报列表" : "月报列表"}
          </CardTitle>
            {activeTab === "weekly" ? (
              <Breadcrumbs
                label={`${currentYear}年${currentMonth}月`}
                prevLabel="上一月"
                nextLabel="下一月"
                onPrev={() => handleYearMonthChange(currentYear, currentMonth - 1)}
                onNext={() => handleYearMonthChange(currentYear, currentMonth + 1)}
              />
            ) : (
              <div className="flex items-center text-xs md:text-sm text-gray-500 mb-2 md:mb-4">
                <Tooltip>
<TooltipTrigger render={<button type="button"
                  onClick={() => handleYearChange(currentYear - 1)}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "mr-1 md:mr-2 p-1 rounded-full hover:bg-gray-100")}
                  aria-label="上一年"
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                </button>} />
<TooltipContent>上一年</TooltipContent>
</Tooltip>
                <span className="font-medium text-gray-700">{currentYear}年</span>
                <Tooltip>
<TooltipTrigger render={<button type="button"
                  onClick={() => handleYearChange(currentYear + 1)}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "ml-1 md:ml-2 p-1 rounded-full hover:bg-gray-100")}
                  aria-label="下一年"
                >
                  <ChevronRightIcon data-icon="inline-start" />
                </button>} />
<TooltipContent>下一年</TooltipContent>
</Tooltip>
              </div>
            )}
          </div>
        </CardHeader>
        
        <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 md:p-12">
            <Skeleton className="h-8 w-8 rounded-full" />
            <span className="text-sm md:text-base text-gray-500">加载中...</span>
          </div>
        ) : (
          <div>
            {activeTab === "weekly" ? (
              <ul className="divide-y divide-gray-200">
                {filteredWeeklyData.length > 0 ? (
                  filteredWeeklyData.map((week) => (
                    <li key={`${week.year}-${week.weekNumber}`} className="p-3 md:p-4">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                        <div className="flex items-start grow">
                          <div className="shrink-0">
                            <FileTextIcon className="h-5 w-5 md:h-6 md:w-6 text-blue-500" />
                          </div>
                          <div className="ml-3 md:ml-4 grow">
                            <div className="flex flex-wrap items-center gap-1 md:gap-2 justify-between w-full">
                              <div className="flex items-center gap-1 md:gap-2">
                                <h3 className="text-sm md:text-base font-medium">{week.year}年第{week.weekNumber}周</h3>
                              {renderReportStatus(week.reportStatus)}
                            </div>
                              <div className="flex items-center gap-1 md:gap-2">
                          {week.reportStatus === "generated" && (
                            <Button variant="outline" size="sm"
                              onClick={() => handlePreviewReport("weekly", week.formattedPeriod)}
                            >
                                    <EyeIcon data-icon="inline-start" />
                              预览
                            </Button>
                          )}
                          {(week.reportStatus === "pending" || week.reportStatus === "generated") && (
                            <Button variant="outline" size="sm"
                              onClick={() => handleGenerateReport("weekly", week.formattedPeriod)}
                              disabled={generatingReportId === `weekly-${week.formattedPeriod}`}
                              className="border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                            >
                                    {generatingReportId === `weekly-${week.formattedPeriod}` ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                                    <span className="hidden md:inline">{generatingReportId === `weekly-${week.formattedPeriod}` ? '生成中...' : '生成周报'}</span>
                                    <span className="inline md:hidden">{generatingReportId === `weekly-${week.formattedPeriod}` ? '生成中' : '生成'}</span>
                            </Button>
                          )}
                              </div>
                            </div>
                            <div className="mt-0.5 md:mt-1 text-xs md:text-sm text-gray-500">
                              <span>{week.formattedPeriod}</span>
                            </div>
                            <div className="mt-1 md:mt-2">
                              {renderDailyStatusIndicators(week.dailyReportStatus, WEEKLY_STATUS_BLOCKS)}
                            </div>
                            {week.generatedAt && (
                              <p className="mt-0.5 md:mt-1 text-xs text-gray-500">
                                生成于 {week.generatedAt}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="p-3 md:p-4">
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>{currentYear}年第{currentMonth}月暂无周报记录</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  </li>
                )}
              </ul>
            ) : (
              <ul className="divide-y divide-gray-200">
                {filteredMonthlyData.length > 0 ? (
                  filteredMonthlyData.map((month) => (
                    <li key={`${month.year}-${month.month}`} className="p-3 md:p-4">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                        <div className="flex items-start grow">
                          <div className="shrink-0">
                            <FileTextIcon className="h-5 w-5 md:h-6 md:w-6 text-blue-500" />
                          </div>
                          <div className="ml-3 md:ml-4 grow">
                            <div className="flex flex-wrap items-center gap-1 md:gap-2 justify-between w-full">
                              <div className="flex items-center gap-1 md:gap-2">
                                <h3 className="text-sm md:text-base font-medium">{month.formattedPeriod}工作月报</h3>
                              {renderReportStatus(month.reportStatus)}
                            </div>
                              <div className="flex items-center gap-1 md:gap-2">
                                {month.reportStatus === "generated" && (
                                  <Button variant="outline" size="sm"
                                    onClick={() => handlePreviewReport("monthly", month.formattedPeriod)}
                                  >
                                    <EyeIcon data-icon="inline-start" />
                                    预览
                                  </Button>
                                )}
                                {(month.reportStatus === "pending" || month.reportStatus === "generated") && (
                                  <Button variant="outline" size="sm"
                                    onClick={() => handleGenerateReport("monthly", month.formattedPeriod)}
                                    disabled={generatingReportId === `monthly-${month.formattedPeriod}`}
                                    className="border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                                  >
                                    {generatingReportId === `monthly-${month.formattedPeriod}` ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                                    <span className="hidden md:inline">{generatingReportId === `monthly-${month.formattedPeriod}` ? '生成中...' : '生成月报'}</span>
                                    <span className="inline md:hidden">{generatingReportId === `monthly-${month.formattedPeriod}` ? '生成中' : '生成'}</span>
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="mt-0.5 md:mt-1 text-xs md:text-sm text-gray-500">
                              <span>{format(month.startDate, 'yyyy-MM-dd')} 至 {format(month.endDate, 'yyyy-MM-dd')}</span>
                            </div>
                            <div className="mt-1 md:mt-2">
                              <div className="flex flex-wrap gap-0.5 md:gap-1 max-w-md">
                                {month.dailyReportStatus.map((day, index) => {
                                  const date = parseISO(day.date);
                                  const dayOfWeek = date.getDay();
                                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                                  // 状态色统一由 lib/utils/status-colors 提供（与共用函数一致）
                                  const statusStyle = getWorkStatusStyle(day.hasReport ? '已完成' : '未开始');
                                  const statusText = day.hasReport ? '已填报' : '未填报';

                                  return (
                                    <div
                                      key={day.date + '-' + index}
                                      className={cn('w-2 h-2 md:w-3 md:h-3 rounded-sm', statusStyle.solidClassName, isWeekend && 'opacity-60')}
                                      title={`${day.date}${isWeekend ? ' (周末)' : ''}: ${statusText}`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                            {month.generatedAt && (
                              <p className="mt-0.5 md:mt-1 text-xs text-gray-500">
                                生成于 {month.generatedAt}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="p-3 md:p-4">
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>{currentYear}年暂无月报记录</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
        </CardContent>
      </Card>
      </TabsContent>
      </Tabs>
      
      {/* 报告预览模态框 */}
      {previewData && (
        <ReportPreview 
          title={previewData.title}
          content={previewData.content}
          onClose={handleClosePreview}
          onSave={handleSaveReport}
        />
      )}
    </div>
  );
}