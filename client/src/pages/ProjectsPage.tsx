
import { useState, useEffect, useRef, useCallback } from "react";
import { PlusIcon, SearchIcon, PencilIcon, TrashIcon, CheckIcon, XIcon, FolderIcon } from "lucide-react";
import { useAuth } from "../contexts/auth-context";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "../lib/api";
import type { Project } from "../lib/db/types";
import { toast } from "@/components/ui/toast";
import { projectSchema, type ProjectFormValues } from "../lib/validators/projects";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { usePersistentState } from '../lib/utils/page-persistence';
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

interface ProjectFormData {
  name: string;
  code: string;
  description: string;
  is_active: boolean;
}

export default function ProjectsPage() {
  const { user } = useAuth();
  
  // 使用持久化状态替代普通状态
  const [projects, setProjects] = usePersistentState<Project[]>('projects-page-projects', []);
  const [searchTerm, setSearchTerm] = usePersistentState<string>('projects-page-search', "");
  const [isAddingProject, setIsAddingProject] = usePersistentState<boolean>('projects-page-adding', false);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProjectId, setEditingProjectId] = usePersistentState<string | null>('projects-page-editing-id', null);
  const [editProject, setEditProject] = usePersistentState<ProjectFormData>('projects-page-edit-form', { 
    name: "", 
    code: "",
    description: "", 
    is_active: true 
  });
  
  // 添加数据已加载的引用
  const dataLoadedRef = useRef(false);
  // 添加最后数据加载时间戳
  const lastLoadTimeRef = useRef<number>(0);
  // 数据刷新间隔（毫秒），设置为5分钟
  const DATA_REFRESH_INTERVAL = 5 * 60 * 1000;
  
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      is_active: true
    }
  });

  // 加载项目数据
  const fetchProjects = useCallback(async () => {
    if (!user) return;
    if (dataLoadedRef.current) {
      console.log('项目数据已加载，跳过重新获取');
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    try {
      const data = await apiGet<{ projects: Project[] }>('/api/projects');

      setProjects(data.projects || []);
      dataLoadedRef.current = true;
    } catch (error) {
      console.error('获取项目失败', error);
      toast.add({ title: '获取项目失败', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [setProjects, user]);

  useEffect(() => {
    if (!user) return;
    
    // 检查数据是否需要重新加载
    const now = Date.now();
    const timeSinceLastLoad = now - lastLoadTimeRef.current;
    
    // 如果数据未加载或超过刷新间隔，则加载数据
    if (!dataLoadedRef.current || timeSinceLastLoad > DATA_REFRESH_INTERVAL) {
      fetchProjects();
      lastLoadTimeRef.current = now;
    } else {
      // 如果数据已加载且未超过刷新间隔，则直接设置加载状态为false
      setIsLoading(false);
    }
  }, [user, fetchProjects]);

  // 添加页面可见性监听
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('项目页面恢复可见，检查数据状态');
          // 只检查数据是否存在，不重新加载
          if (user && projects.length === 0) {
            console.log('项目数据不存在，重新加载');
            dataLoadedRef.current = false;
            fetchProjects();
          }
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [user, projects, fetchProjects]);

  // 搜索过滤项目
  const filteredProjects = projects.filter(
    project =>
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 添加新项目
  const onSubmit = async (data: ProjectFormValues) => {
    if (!user) return;

    try {
      const res = await apiPost<{ project: Project }>('/api/projects', {
        name: data.name,
        code: data.code,
        description: data.description || '',
        is_active: data.is_active,
      });

      setProjects([res.project, ...projects]);
      setIsAddingProject(false);
      reset();
      toast.add({ title: '项目创建成功', type: 'success' });
    } catch (error) {
      console.error('创建项目失败', error);
      toast.add({ title: error instanceof ApiError ? error.message : '创建项目失败', type: 'error' });
    }
  };

  // 开始编辑项目
  const startEditingProject = (project: Project) => {
    setEditingProjectId(project.id);
    setEditErrors({});
    setEditProject({ 
      name: project.name,
      code: project.code, 
      description: project.description || "", 
      is_active: project.is_active 
    });
  };

  // 保存编辑后的项目
  const saveEditedProject = async () => {
    if (!editingProjectId || !user) return;

    const parsed = projectSchema.pick({ name: true, code: true, description: true }).safeParse({
      name: editProject.name,
      code: editProject.code,
      description: editProject.description,
    });
    if (!parsed.success) {
      const fieldErrors: { name?: string; code?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'name' || key === 'code') && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setEditErrors(fieldErrors);
      return;
    }
    setEditErrors({});

    try {
      const res = await apiPut<{ project: Project }>(`/api/projects/${editingProjectId}`, {
        name: editProject.name,
        code: editProject.code,
        description: editProject.description,
        is_active: editProject.is_active,
      });

      setProjects(
        projects.map(p =>
          p.id === editingProjectId
            ? res.project
            : p
        )
      );
      setEditingProjectId(null);
      toast.add({ title: '项目更新成功', type: 'success' });
    } catch (error) {
      console.error('更新项目失败', error);
      toast.add({ title: error instanceof ApiError ? error.message : '更新项目失败', type: 'error' });
    }
  };

  // 取消编辑
  const cancelEditing = () => {
    setEditingProjectId(null);
  };

  // 删除项目
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // 编辑表单字段级错误（与新建表单的 zod 规则一致）
  const [editErrors, setEditErrors] = useState<{ name?: string; code?: string }>({});

  const deleteProject = async (id: string) => {
    if (!user) return;

    try {
      await apiDelete(`/api/projects/${id}`);

      setProjects(projects.filter(p => p.id !== id));
      toast.add({ title: '项目已删除', type: 'success' });
    } catch (error) {
      console.error('删除项目失败', error);
      toast.add({ title: '删除项目失败', type: 'error' });
    } finally {
      setDeleteTargetId(null);
    }
  };

  // 切换项目状态
  const toggleProjectStatus = async (id: string, currentStatus: boolean) => {
    if (!user) return;
    
    try {
      const newStatus = !currentStatus;
      await apiPut(`/api/projects/${id}`, {
        is_active: newStatus,
      });

      setProjects(
        projects.map(p =>
          p.id === id
            ? { ...p, is_active: newStatus }
            : p
        )
      );

      toast.add({ title: `项目已${newStatus ? '激活' : '停用'}`, type: 'success' });
    } catch (error) {
      console.error('更新项目状态失败', error);
      toast.add({ title: '更新项目状态失败', type: 'error' });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">项目管理</h1>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {/* 搜索框 */}
          <InputGroup className="w-full sm:w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              placeholder="搜索项目..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </InputGroup>

          {/* 添加项目按钮 */}
          <Button onClick={() => setIsAddingProject(true)}>
            <PlusIcon data-icon="inline-start" />
            添加项目
          </Button>
        </div>
      </div>

      {/* 添加项目弹窗 */}
      <Dialog open={isAddingProject} onOpenChange={(open) => { if (!open) { setIsAddingProject(false); reset(); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加新项目</DialogTitle>
            <DialogDescription>
              填写项目基本信息，创建后可在工作分解中维护层级结构。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="name">
                  项目名称 <span className="text-destructive">*</span>
                </FieldLabel>
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => {
                    // ui Input 是普通函数组件（无 forwardRef），React 18 下不能接收 field.ref
                    const { ref, ...inputProps } = field;
                    return (
                      <Input id="name" placeholder="输入项目名称" aria-invalid={!!errors.name} {...inputProps} />
                    );
                  }}
                />
                <FieldError errors={errors.name ? [{ message: errors.name.message }] : []} />
              </Field>
              <Field>
                <FieldLabel htmlFor="code">
                  项目编号 <span className="text-destructive">*</span>
                </FieldLabel>
                <Controller
                  name="code"
                  control={control}
                  render={({ field }) => {
                    const { ref, ...inputProps } = field;
                    return (
                      <Input id="code" placeholder="输入项目编号" aria-invalid={!!errors.code} {...inputProps} />
                    );
                  }}
                />
                <FieldError errors={errors.code ? [{ message: errors.code.message }] : []} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="description">
                项目描述
              </FieldLabel>
              <Controller
                name="description"
                control={control}
                render={({ field }) => {
                  const { ref, ...inputProps } = field;
                  return (
                    <Textarea id="description" rows={3} placeholder="输入项目描述（可选）" {...inputProps} />
                  );
                }}
              />
              <FieldError errors={[]} />
            </Field>
            <Field orientation="horizontal">
              <Controller
                name="is_active"
                control={control}
                render={({ field }) => (
                  <Checkbox id="is_active" checked={!!field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                )}
              />
              <FieldLabel htmlFor="is_active">项目活跃</FieldLabel>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddingProject(false);
                  reset();
                }}
              >
                取消
              </Button>
              <Button type="submit">
                保存项目
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 项目列表 */}
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Spinner className="size-8 text-primary" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <Empty className="p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderIcon />
              </EmptyMedia>
              <EmptyTitle>暂无项目数据</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setIsAddingProject(true)}>
                <PlusIcon data-icon="inline-start" />
                添加第一个项目
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目名称</TableHead>
                <TableHead className="hidden sm:table-cell">项目编号</TableHead>
                <TableHead className="hidden md:table-cell">描述</TableHead>
                <TableHead className="hidden sm:table-cell">状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProjects.map((project) => (
                <TableRow key={project.id} className={!project.is_active ? "bg-muted/50" : undefined}>
                  <TableCell>
                    <div className="flex flex-col">
                      <div className="text-sm font-medium text-foreground">{project.name}</div>
                      {/* 移动端显示项目编号和状态 */}
                      <div className="mt-1 text-xs text-muted-foreground sm:hidden">
                        {project.code} · {project.is_active ? "活跃" : "未活跃"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="text-sm text-foreground">{project.code}</div>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell">
                    <div className="line-clamp-2 text-sm text-muted-foreground">{project.description || "-"}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant={project.is_active ? "default" : "outline"}>
                      {project.is_active ? "活跃" : "未活跃"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {editingProjectId === project.id ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={saveEditedProject}
                        >
                          <CheckIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={cancelEditing}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Tooltip>
                          <TooltipTrigger
                            onClick={() => startEditingProject(project)}
                            aria-label="编辑项目"
                            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                          >
                            <PencilIcon />
                          </TooltipTrigger>
                          <TooltipContent>编辑项目</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            onClick={() => setDeleteTargetId(project.id)}
                            aria-label="删除项目"
                            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                          >
                            <TrashIcon />
                          </TooltipTrigger>
                          <TooltipContent>删除项目</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            onClick={() => toggleProjectStatus(project.id, project.is_active)}
                            aria-label={project.is_active ? "设为未活跃" : "设为活跃"}
                            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                          >
                            {project.is_active ? <XIcon /> : <CheckIcon />}
                          </TooltipTrigger>
                          <TooltipContent>{project.is_active ? "设为未活跃" : "设为活跃"}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* 编辑项目弹窗 */}
      <Dialog open={editingProjectId !== null} onOpenChange={(open) => { if (!open) cancelEditing(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑项目</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="edit-name">
                项目名称 <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="edit-name"
                type="text"
                value={editProject.name}
                onChange={(e) => setEditProject({ ...editProject, name: e.target.value })}
                required
                aria-invalid={!!editErrors.name}
              />
              <FieldError errors={editErrors.name ? [{ message: editErrors.name }] : []} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-code">
                项目编号 <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="edit-code"
                type="text"
                value={editProject.code}
                onChange={(e) => setEditProject({ ...editProject, code: e.target.value })}
                required
                aria-invalid={!!editErrors.code}
              />
              <FieldError errors={editErrors.code ? [{ message: editErrors.code }] : []} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-description">
                项目描述
              </FieldLabel>
              <Textarea
                id="edit-description"
                rows={3}
                value={editProject.description}
                onChange={(e) => setEditProject({ ...editProject, description: e.target.value })}
              />
              <FieldError errors={[]} />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="edit-is_active"
                checked={editProject.is_active}
                onCheckedChange={(checked) => setEditProject({ ...editProject, is_active: checked === true })}
              />
              <FieldLabel htmlFor="edit-is_active">项目活跃</FieldLabel>
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={cancelEditing}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={saveEditedProject}
            >
              保存更改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除项目确认 */}
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除此项目吗？删除后将无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTargetId(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (deleteTargetId) deleteProject(deleteTargetId); }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}