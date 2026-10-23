import { useState, useEffect } from "react";
import { CalendarIcon, TrashIcon, SaveIcon, CopyIcon, EyeIcon, FileTextIcon, PlusCircleIcon } from "lucide-react";
import { useAuth } from "../contexts/auth-context";
import { apiGet, apiPost } from "../lib/api";
import type { Project } from "../lib/db/types";
import { toast } from "@/components/ui/toast";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface WorkItem {
  id?: string;
  content: string;
  projectId: string;
  projectName?: string;
  projectCode?: string;
}

interface ReportItemData {
  id: string;
  content: string;
  project_id: string;
  projects?: { id: string; name: string; code: string } | { id: string; name: string; code: string }[] | null;
}

interface DailyReportDialogProps {
  open: boolean;
  date: string | null;
  projects: Project[];
  initialItems: WorkItem[];
  initialExistingReport: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export default function DailyReportDialog({ open, date: initialDate, projects, initialItems, initialExistingReport, onOpenChange, onSaved }: DailyReportDialogProps) {
  const { user } = useAuth();

  const [isSaving, setIsSaving] = useState(false);
  const [date, setDate] = useState(initialDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [workItems, setWorkItems] = useState<WorkItem[]>(initialItems);
  const [existingReport, setExistingReport] = useState(initialExistingReport);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProjectError, setSelectedProjectError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // 弹窗打开时用父组件预加载好的初始数据重置表单
  useEffect(() => {
    if (open) {
      setDate(initialDate ?? format(new Date(), 'yyyy-MM-dd'));
      setWorkItems(initialItems);
      setExistingReport(initialExistingReport);
      setShowPreview(false);
      setSelectedProjectId('');
      setSelectedProjectError(null);
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 处理日期变更：dialog 已打开，调用 daily-reports 检查/加载该日期；失败走 dialog 内 formError
  const handleDateChange = async (newDate: string) => {
    setDate(newDate);
    setFormError(null);
    setSelectedProjectError(null);
    setWorkItems([]);
    setExistingReport(false);
    if (!user) return;
    try {
      const data = await apiGet<{ reports: Array<{ id: string; report_items: ReportItemData[] }> }>(
        `/api/daily-reports?date=${newDate}&with_items=1`
      );
      const report = data.reports[0];
      if (report?.id) {
        setExistingReport(true);
        const typedItems = (report.report_items || []) as ReportItemData[];
        setWorkItems(typedItems.map(item => {
          const project = Array.isArray(item.projects) ? item.projects[0] : item.projects;
          return {
            id: item.id,
            content: item.content,
            projectId: item.project_id,
            projectName: project?.name,
            projectCode: project?.code,
          };
        }));
      }
    } catch (error) {
      console.error('切换日期加载日报失败', error);
      setFormError(error instanceof Error ? `加载日报数据失败: ${error.message}` : '加载日报数据失败');
    }
  };

  // 处理工作项内容变更（按全局下标）
  const handleWorkItemContentChange = (index: number, content: string) => {
    if (index < 0 || index >= workItems.length) return;
    const newWorkItems = [...workItems];
    newWorkItems[index] = { ...newWorkItems[index], content };
    setWorkItems(newWorkItems);
  };

  // 添加新的工作项
  const addWorkItem = () => {
    const projectId = selectedProjectId || (workItems.length > 0
      ? workItems[workItems.length - 1].projectId
      : (projects.length > 0 ? projects[0].id : ''));

    if (projectId === '') {
      setSelectedProjectError('请先选择一个项目');
      return;
    }

    setSelectedProjectError(null);
    setWorkItems([...workItems, { content: '', projectId }]);
    setSelectedProjectId('');
  };

  // 添加特定项目的工作项
  const handleAddWorkItem = (projectId: string) => {
    if (!projectId) return;
    setWorkItems([...workItems, { content: '', projectId }]);
  };

  // 删除工作项（按全局下标）
  const removeWorkItem = (index: number) => {
    if (index < 0 || index >= workItems.length) return;
    const newWorkItems = [...workItems];
    newWorkItems.splice(index, 1);
    setWorkItems(newWorkItems);
  };

  // 按项目分组（优先使用日报明细自带的项目信息，避免停用/非活跃项目被过滤）
  const workItemsGroupedByProject = (() => {
    const groups = new Map<string, {
      projectId: string;
      projectName: string;
      items: Array<WorkItem & { globalIndex: number }>;
    }>();

    workItems.forEach((item, globalIndex) => {
      if (!item.projectId) return;
      let group = groups.get(item.projectId);
      if (!group) {
        const project = projects.find(p => p.id === item.projectId);
        const name = project?.name || item.projectName || item.projectId;
        const code = project?.code || item.projectCode;
        group = {
          projectId: item.projectId,
          projectName: code ? `${name} (${code})` : name,
          items: [],
        };
        groups.set(item.projectId, group);
      }
      group.items.push({ ...item, globalIndex });
    });

    return [...groups.values()];
  })();

  // 可选项目（已使用的不再显示）
  const usedProjectIds = Array.from(new Set(workItems.map(item => item.projectId))).filter(id => id !== '');
  const availableProjects = projects.filter(project => !usedProjectIds.includes(project.id));

  // 复制预览内容为YAML格式
  const handleCopyPreview = () => {
    const validWorkItems = workItems.filter(item => item.content.trim() !== '' && item.projectId);
    const projectMap = new Map<string, { name: string; items: string[] }>();
    validWorkItems.forEach(item => {
      const project = projects.find(p => p.id === item.projectId);
      const name = project?.name || item.projectName || item.projectId;
      if (!projectMap.has(item.projectId)) {
        projectMap.set(item.projectId, { name, items: [] });
      }
      projectMap.get(item.projectId)?.items.push(item.content);
    });
    let yamlContent = '';
    projectMap.forEach(project => {
      yamlContent += `${project.name}:\n`;
      project.items.forEach(content => {
        yamlContent += `  - ${content}\n`;
      });
    });
    navigator.clipboard.writeText(yamlContent)
      .then(() => {
        toast.add({ title: '日报内容已复制到剪贴板', type: 'success' });
      })
      .catch(err => {
        console.error('复制失败:', err);
        toast.add({ title: '复制失败，请重试', type: 'error' });
      });
  };

  // 切换预览模式
  const togglePreview = () => {
    setShowPreview(!showPreview);
  };

  // 保存日报（服务端按日期 upsert，明细全量替换）
  const handleSave = async () => {
    setFormError(null);
    if (!user) {
      setFormError('用户未登录');
      return;
    }
    const filteredItems = workItems.filter(item =>
      item.content.trim() !== '' && item.projectId
    );
    if (filteredItems.length === 0) {
      setFormError('请先添加工作内容');
      return;
    }
    setIsSaving(true);
    try {
      await apiPost('/api/daily-reports', {
        date,
        items: filteredItems.map(item => ({ project_id: item.projectId, content: item.content.trim() })),
      });
      toast.add({ title: existingReport ? '日报更新成功' : '日报创建成功', type: 'success' });
      setShowPreview(false);
      onSaved();
      onOpenChange(false);
    } catch (error) {
      console.error('保存日报失败', error);
      setFormError(error instanceof Error ? `保存日报失败: ${error.message}` : '保存日报失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existingReport ? '编辑日报' : '新建日报'}
            {existingReport && (
              <Badge variant="secondary" className="ml-2">
                已有日报
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>填写该日期各项目的工作内容</DialogDescription>
        </DialogHeader>

        {projects.length === 0 && workItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            您目前没有活跃的项目，请先在项目管理中创建并激活项目后再创建日报。
          </p>
        ) : showPreview ? (
          <div className="min-h-0 grow overflow-auto p-1">
            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle>日报预览</CardTitle>
                <CardDescription>查看格式化后的日报内容</CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={handleCopyPreview}>
                    <CopyIcon data-icon="inline-start" />
                    复制
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-col gap-2 border-b border-border pb-4">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground sm:text-base">{date} ({format(new Date(date), 'EEEE', { locale: zhCN })})</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={existingReport ? "default" : "outline"}>
                      {existingReport ? '已提交' : '未提交'}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-col gap-5">
                  {workItemsGroupedByProject.map(group => {
                    const projectWorkItems = group.items.filter(item => item.content.trim() !== '');
                    if (projectWorkItems.length === 0) return null;
                    return (
                      <div key={group.projectId} className="rounded-md border-l-2 border-primary bg-accent/50 py-2 pl-3 sm:pl-4">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-medium text-primary sm:text-sm">
                          <FileTextIcon className="size-3.5" />
                          {group.projectName}
                        </div>
                        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs text-foreground sm:gap-2 sm:text-sm">
                          {projectWorkItems.map((item, idx) => (
                            <li key={idx} className="break-words whitespace-pre-wrap">
                              {item.content}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                {(workItems.length === 0 || workItems.every(item => !item.content.trim())) && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>预览将在此处显示</EmptyTitle>
                      <EmptyDescription>请先使用&quot;选择项目...&quot;下拉框添加工作项</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex min-h-0 grow flex-col gap-4 overflow-auto p-1 [&>*]:shrink-0">
            <Field>
              <FieldLabel htmlFor="daily-dialog-date">
                日报日期
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <CalendarIcon />
                </InputGroupAddon>
                <InputGroupInput
                  type="date"
                  id="daily-dialog-date"
                  value={date}
                  onChange={(e) => handleDateChange(e.target.value)}
                  required
                />
              </InputGroup>
              <FieldError errors={[]} />
            </Field>
            {existingReport && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  已有日报
                </Badge>
                <span className="text-xs text-muted-foreground sm:text-sm">
                  已加载该日期的日报内容
                </span>
              </div>
            )}

            <h3 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
              <FileTextIcon className="size-4" />今日工作内容
            </h3>

            {projects.length > 0 && (
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">添加新项目工作</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <Field className="grow">
                      <FieldLabel htmlFor="daily-dialog-project">选择项目</FieldLabel>
                      <Select value={selectedProjectId || "__none"} onValueChange={(value: string | null) => { setSelectedProjectId(value === null || value === "__none" ? "" : value); setSelectedProjectError(null); }} items={[{ label: '选择项目...', value: '__none' }, ...availableProjects.map((project) => ({ label: `${project.name} (${project.code})`, value: project.id }))]}>
                        <SelectTrigger id="daily-dialog-project" className="w-full" aria-invalid={!!selectedProjectError}>
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
                      <FieldError errors={selectedProjectError ? [{ message: selectedProjectError }] : []} />
                    </Field>
                    <Button variant="outline" size="sm"
                      type="button"
                      onClick={addWorkItem}
                      disabled={!selectedProjectId}
                    >
                      <PlusCircleIcon data-icon="inline-start" /> 添加
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {workItemsGroupedByProject.map((group) => (
              <Card key={group.projectId} size="sm">
                <CardHeader>
                  <CardTitle className="text-sm text-primary">{group.projectName}</CardTitle>
                  <CardAction>
                    <Button variant="outline" size="sm"
                      type="button"
                      onClick={() => handleAddWorkItem(group.projectId)}
                    >
                      <PlusCircleIcon data-icon="inline-start" /> 添加
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 sm:gap-3">
                  {group.items.map((item) => (
                    <div key={item.globalIndex} className="flex items-start gap-2 rounded-lg bg-muted p-2 sm:p-3">
                      <Field className="grow">
                        <FieldLabel htmlFor={`daily-dialog-item-${item.globalIndex}`} className="sr-only">工作内容</FieldLabel>
                        <Textarea
                          id={`daily-dialog-item-${item.globalIndex}`}
                          rows={2}
                          value={item.content}
                          onChange={(e) => handleWorkItemContentChange(item.globalIndex, e.target.value)}
                          placeholder="请输入工作内容..."
                          className="bg-background"
                        />
                        <FieldError errors={[]} />
                      </Field>
                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          onClick={() => removeWorkItem(item.globalIndex)}
                          aria-label="删除工作项"
                          className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
                        >
                          <TrashIcon data-icon="inline-start" />
                        </TooltipTrigger>
                        <TooltipContent>删除工作项</TooltipContent>
                      </Tooltip>
                    </div>
                  ))}
                  {group.items.length === 0 && (
                    <div className="py-2 text-center text-xs text-muted-foreground sm:py-3 sm:text-sm">
                      点击&quot;添加&quot;按钮开始添加工作内容
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {workItems.length === 0 && projects.length > 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileTextIcon data-icon="inline-start" />
                  </EmptyMedia>
                  <EmptyTitle>请使用上方&quot;选择项目...&quot;下拉框添加工作项</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        )}

        {formError && (
          <Field>
            <FieldError errors={[{ message: formError }]} />
          </Field>
        )}

        <DialogFooter>
          {(projects.length > 0 || workItems.length > 0) && (
            <Button variant="outline" size="sm"
              type="button"
              onClick={togglePreview}
            >
              <EyeIcon data-icon="inline-start" />
              {showPreview ? '返回编辑' : '预览'}
            </Button>
          )}
          <Button size="sm"
            type="button"
            onClick={handleSave}
            disabled={isSaving || (projects.length === 0 && workItems.length === 0)}
          >
            {isSaving ? (
              <>
                <Spinner data-icon="inline-start" />
                保存中...
              </>
            ) : (
              <>
                <SaveIcon data-icon="inline-start" />
                {existingReport ? '更新' : '保存'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
