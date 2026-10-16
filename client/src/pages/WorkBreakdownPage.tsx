
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useAuth } from "../contexts/auth-context";
import { apiGet } from "../lib/api";
import type { Project } from "../lib/db/types";
import { WorkBreakdownService, WorkItem } from "../lib/services/work-breakdown";
import { toast } from "@/components/ui/toast";
import { PlusIcon, ChevronDownIcon, ChevronRightIcon, XIcon, Clock as ClockIcon, TrendingUp as TrendingUpIcon, Lightbulb as LightbulbIcon, Network as NetworkIcon, List as ListIcon, Orbit as OrbitIcon } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

// 导入SortableWorkItem组件
import { SortableWorkItem } from './SortableWorkItem';

// 导入进度计算工具和组件
import { calculateWorkItemProgress } from '../lib/utils/progress-calculator';
import { WORK_STATUS_OPTIONS, getWorkStatusStyle } from '../lib/utils/status-colors';
import ProgressIndicator from '../components/work-breakdown/ProgressIndicator';

// 导入移动对话框组件
import MoveWorkItemDialog from './MoveWorkItemDialog';

// 导入工作项编辑对话框组件（新建/编辑统一走 Dialog + Field 表单）
import WorkItemDialog, { WorkItemDialogFields } from './WorkItemDialog';

// 懒加载工作导图组件
const WorkMap = lazy(() => import('./WorkMap'));

// 懒加载 3D 世界组件（three.js 体积大，单独分包）
const WorkBreakdown3DWorld = lazy(() => import('../components/work-breakdown/WorkBreakdown3DWorld'));

// 视图模式：列表（含新建/编辑/拖拽操作）、工作导图与 3D 世界
type ViewMode = 'list' | 'map' | '3d';


export default function WorkBreakdownPage() {
  const { user } = useAuth();
  const workBreakdownService = new WorkBreakdownService();
  
  // 状态
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list'); // 默认列表模式
  const [isSaving, setIsSaving] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null); // 待删除的工作项ID
  // 新建/编辑工作项对话框（替代原行内编辑表单）
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<
    | { kind: 'create-root' }
    | { kind: 'create-child'; parentId: string }
    | { kind: 'edit'; itemId: string }
    | null
  >(null);
  // 添加移动相关状态
  const [itemToMove, setItemToMove] = useState<WorkItem | null>(null); // 待移动的工作项
  const [showMoveDialog, setShowMoveDialog] = useState(false); // 是否显示移动对话框
  const [allPotentialParents, setAllPotentialParents] = useState<Array<{ id: string; name: string; level: number; path: string }>>([]);
  // 添加请求控制状态
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  
  // 添加层级展开控制
  const [expandLevel, setExpandLevel] = useState<number>(4); // 默认展开所有层级
  
  // 添加工作状态筛选相关状态
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [filteredWorkItems, setFilteredWorkItems] = useState<WorkItem[]>([]);

  // 添加选中工作项状态（用于预览模式下的进度概览）
  const [selectedWorkItem, setSelectedWorkItem] = useState<WorkItem | null>(null);

  // 拖拽传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // 添加数据加载状态跟踪和刷新间隔
  const dataLoadedRef = useRef<boolean>(false);
  const lastLoadTimeRef = useRef<number>(0);
  
  // 加载项目数据
  const fetchProjects = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const data = await apiGet<{ projects: Project[] }>('/api/projects?active_only=true');

      setProjects(data.projects || []);

      // 如果有活跃项目，默认选择第一个
      if (data.projects && data.projects.length > 0) {
        setSelectedProject(data.projects[0] as Project);
        // 不在这里加载工作分解数据，让useEffect处理
      }

      // 更新数据加载状态和时间戳
      const now = Date.now();
      lastLoadTimeRef.current = now;
    } catch (error) {
      console.error('获取项目失败', error);
      toast.add({ title: '获取项目失败', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // 获取项目的工作分解数据
  const fetchWorkBreakdownItems = useCallback(async (projectId: any) => {
    if (!projectId || !user?.id) {
      return;
    }
    
    setIsLoadingItems(true);
    setIsLoading(true);
    
    try {
      console.log(`加载项目${projectId}的工作分解数据`);
      const workItemsTree = await workBreakdownService.getWorkBreakdownItems(
        projectId
      );
      
      // 确保所有从数据库加载的工作项都有正确的ID格式
      const ensureCorrectIdFormat = (items: WorkItem[]): WorkItem[] => {
        return items.map(item => {
          // 如果有数据库ID但没有db-前缀，添加前缀
          if (item.dbId && !item.id.startsWith('db-')) {
            item.id = `db-${item.dbId}`;
          }
          
          // 递归处理子项
          if (item.children.length > 0) {
            item.children = ensureCorrectIdFormat(item.children);
          }
          
          return item;
        });
      };
      
      const formattedItems = ensureCorrectIdFormat(workItemsTree);
      console.log('处理后的工作项数据:', formattedItems);
      
      // 根据当前展开层级设置初始展开状态
      const setInitialExpandState = (items: WorkItem[], currentLevel: number = 0): WorkItem[] => {
        return items.map(item => {
          const shouldExpand = currentLevel < expandLevel;
          return {
            ...item,
            isExpanded: item.isExpanded !== undefined ? item.isExpanded : shouldExpand,
            children: item.children.length > 0 ? setInitialExpandState(item.children, currentLevel + 1) : []
          };
        });
      };
      
      const itemsWithExpandState = setInitialExpandState(formattedItems);
      setWorkItems(itemsWithExpandState);
      setLastProjectId(projectId);

      // 计算所有可能的移动目标
      const potentialParents = calculateAllPotentialParents(itemsWithExpandState);
      setAllPotentialParents(potentialParents);

      // 更新数据加载状态和时间戳
      dataLoadedRef.current = true;
      lastLoadTimeRef.current = Date.now();
    } catch (error) {
      console.error('获取工作分解数据失败', error);
      toast.add({ title: '获取工作分解数据失败', type: 'error' });
    } finally {
      setIsLoading(false);
      setIsLoadingItems(false);
    }
  }, [user, workBreakdownService, expandLevel]);

  // 添加页面可见性监听
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('工作分解页面恢复可见，保持现有数据');
          // 不再自动刷新数据
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, []);

  // 初始加载
  useEffect(() => {
    if (user && !dataLoadedRef.current) {
      fetchProjects();
    }
  }, [user, fetchProjects]);

  // 当选择的项目变化时，加载该项目的工作分解数据
  useEffect(() => {
    if (selectedProject?.id && user?.id && !isLoadingItems) {
      // 只有当项目ID变化时或数据未加载时才重新加载数据
      if (selectedProject.id !== lastProjectId || !dataLoadedRef.current) {
        fetchWorkBreakdownItems(selectedProject.id);
      }
    }
  }, [selectedProject, user, fetchWorkBreakdownItems, lastProjectId, isLoadingItems]);

  // 规范化ID，处理前缀
  const normalizeId = (id: string): string => {
    if (!id) return '';
    return id.startsWith('db-') ? id.substring(3) : id;
  };
  
  // 检查两个ID是否匹配（考虑前缀）
  const isIdMatch = (id1: string | undefined | null, id2: string | undefined | null): boolean => {
    if (!id1 || !id2) return false;
    
    const normalized1 = normalizeId(id1);
    const normalized2 = normalizeId(id2);
    
    // 直接匹配
    if (normalized1 === normalized2) return true;
    
    // 检查一个ID是否包含在另一个ID中（处理部分匹配的情况）
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      console.log(`部分ID匹配: ${id1} 与 ${id2}`);
      return true;
    }
    
    return false;
  };

  // 添加根级工作项（打开对话框，保存时再落库）
  const addRootWorkItem = () => {
    if (!selectedProject || !user?.id) return;
    setDialogMode({ kind: 'create-root' });
    setDialogOpen(true);
  };

  // 添加子工作项（打开对话框，保存时再落库）
  const addChildWorkItem = (parentId: string) => {
    if (!selectedProject || !user?.id) return;
    setDialogMode({ kind: 'create-child', parentId });
    setDialogOpen(true);
  };

  // 切换展开/折叠
  const toggleExpand = async (id: string) => {
    // 查找工作项并切换展开状态
    const updateWorkItems = (items: WorkItem[]): WorkItem[] => {
      return items.map(item => {
        // 检查ID匹配，同时处理带有db-前缀的情况
        const isMatch = item.id === id || 
                       (item.dbId && `db-${item.dbId}` === id);
        
        if (isMatch) {
          const newExpandState = !item.isExpanded;
          
          // 如果有数据库ID，更新数据库
          if (item.dbId) {
            workBreakdownService.updateWorkItem(item.dbId, { is_expanded: newExpandState })
              .catch(error => {
                console.error('更新展开状态失败', error);
              });
          }
          
          return {
            ...item,
            isExpanded: newExpandState
          };
        } else if (item.children.length > 0) {
          return {
            ...item,
            children: updateWorkItems(item.children)
          };
        }
        return item;
      });
    };
    
    setWorkItems(updateWorkItems(workItems));
  };
  
  // 在树中按 id（兼容 db- 前缀）查找工作项
  const findWorkItemById = (items: WorkItem[], targetId: string): WorkItem | null => {
    for (const item of items) {
      if (isIdMatch(item.id, targetId) || isIdMatch(item.dbId, targetId)) return item;
      if (item.children.length > 0) {
        const found = findWorkItemById(item.children, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  // 递归更新树中指定节点的展示字段
  const updateTreeFields = (
    items: WorkItem[],
    targetId: string,
    fields: WorkItemDialogFields,
  ): WorkItem[] => {
    return items.map(item => {
      if (isIdMatch(item.id, targetId) || isIdMatch(item.dbId, targetId)) {
        return {
          ...item,
          name: fields.name,
          description: fields.description,
          status: fields.status,
          tags: fields.tags,
          members: fields.members,
          progress_notes: fields.progressNotes,
        };
      }
      if (item.children.length > 0) {
        return { ...item, children: updateTreeFields(item.children, targetId, fields) };
      }
      return item;
    });
  };

  // 对话框标题与初始值
  const dialogTitle =
    dialogMode?.kind === 'edit' ? '编辑工作项'
    : dialogMode?.kind === 'create-child' ? '新建子工作项'
    : '新建1级工作项';

  const dialogInitial: WorkItemDialogFields = (() => {
    if (dialogMode?.kind === 'edit') {
      const item = findWorkItemById(workItems, dialogMode.itemId);
      if (item) {
        return {
          name: item.name || '',
          description: item.description || '',
          status: item.status || '未开始',
          tags: item.tags || '',
          members: item.members || '',
          progressNotes: item.progress_notes || '',
        };
      }
    }
    return { name: '', description: '', status: '未开始', tags: '', members: '', progressNotes: '' };
  })();

  // 对话框保存：新建落库后插入树 / 编辑落库后更新树
  const handleDialogSave = async (fields: WorkItemDialogFields) => {
    if (!selectedProject || !user?.id || !dialogMode) return;
    setIsSaving(true);
    try {
      if (dialogMode.kind === 'edit') {
        const found = findWorkItemById(workItems, dialogMode.itemId);
        if (!found || !found.dbId) throw new Error('未找到工作项');
        await workBreakdownService.updateWorkItem(found.dbId, {
          name: fields.name,
          description: fields.description,
          status: fields.status,
          tags: fields.tags,
          members: fields.members,
          progress_notes: fields.progressNotes,
        });
        setWorkItems(updateTreeFields(workItems, dialogMode.itemId, fields));
        toast.add({ title: '更新工作项成功', type: 'success' });
      } else {
        const parentId = dialogMode.kind === 'create-child' ? dialogMode.parentId : null;
        const parent = parentId ? findWorkItemById(workItems, parentId) : null;
        if (parentId && (!parent || !parent.dbId)) throw new Error('未找到父级工作项');
        const level = parent ? parent.level + 1 : 0;
        const position = parent ? parent.children.length : workItems.length;
        const result = await workBreakdownService.addWorkItem(
          selectedProject.id,
          fields.name,
          fields.description,
          parent?.dbId ?? null,
          level,
          position,
          fields.status,
          fields.tags,
          fields.members,
          fields.progressNotes,
        );
        const newItem: WorkItem = {
          id: `db-${result.id}`,
          dbId: result.id,
          name: fields.name,
          description: fields.description,
          children: [],
          isExpanded: true,
          level,
          position,
          status: fields.status,
          tags: fields.tags,
          members: fields.members,
          progress_notes: fields.progressNotes,
        };
        const insertChild = (items: WorkItem[]): WorkItem[] => items.map(item => {
          if (parentId && (isIdMatch(item.id, parentId) || isIdMatch(item.dbId, parentId))) {
            return { ...item, isExpanded: true, children: [...item.children, newItem] };
          }
          if (item.children.length > 0) return { ...item, children: insertChild(item.children) };
          return item;
        });
        const newTree = parent ? insertChild(workItems) : [...workItems, newItem];
        setWorkItems(newTree);
        // 新建后刷新可移动父级列表
        setAllPotentialParents(calculateAllPotentialParents(newTree));
        toast.add({ title: '添加工作项成功', type: 'success' });
      }
    } catch (error) {
      console.error('保存工作项失败', error);
      toast.add({ title: `保存工作项失败: ${error instanceof Error ? error.message : '未知错误'}`, type: 'error' });
      return;
    } finally {
      setIsSaving(false);
    }
    setDialogOpen(false);
  };

  // 确认删除工作项
  const confirmDeleteWorkItem = async () => {
    if (!itemToDelete) return;
    
    const id = itemToDelete;
    setIsSaving(true);
    
    console.log('开始删除工作项:', id);
    
    try {
      // 直接从ID中提取数据库ID
      let dbId = null;
      
      if (id.startsWith('db-')) {
        // 如果ID格式为 db-xxx，直接提取
        dbId = id.substring(3);
        console.log('从ID中提取数据库ID:', dbId);
      } else {
        // 否则尝试在工作项中查找
        const findDbId = (items: WorkItem[]): string | null => {
          for (const item of items) {
            if (item.id === id) {
              return item.dbId || null;
            }
            if (item.children.length > 0) {
              const foundId = findDbId(item.children);
              if (foundId) return foundId;
            }
          }
          return null;
        };
        
        dbId = findDbId(workItems);
        console.log('从工作项中查找数据库ID:', dbId);
      }
      
      // 查找工作项对象，用于临时项判断和UI更新
      const findItem = (items: WorkItem[]): WorkItem | null => {
        for (const item of items) {
          if (item.id === id || (item.dbId && `db-${item.dbId}` === id) || 
              (id.startsWith('db-') && item.dbId === id.substring(3))) {
            return item;
          }
          if (item.children.length > 0) {
            const found = findItem(item.children);
            if (found) return found;
          }
        }
        return null;
      };
      
      const foundItem = findItem(workItems);
      console.log('找到的工作项:', foundItem ? {
        id: foundItem.id,
        dbId: foundItem.dbId,
        name: foundItem.name
      } : '未找到');
      
      // 准备删除后的工作项列表
      const removeItem = (items: WorkItem[]): WorkItem[] => {
        return items
          .filter(item => {
            const isMatch = item.id === id || 
                          (item.dbId && `db-${item.dbId}` === id) ||
                          (id.startsWith('db-') && item.dbId === id.substring(3));
            return !isMatch;
          })
          .map(item => ({
            ...item,
            children: removeItem(item.children)
          }));
      };
      
      // 如果有数据库ID，从数据库中删除
      if (dbId) {
        console.log('从数据库中删除工作项:', dbId);
        await workBreakdownService.deleteWorkItem(dbId);
        
        // 数据库删除成功后，更新前端状态
        const newItems = removeItem(workItems);
        setWorkItems(newItems);
        
        toast.add({ title: '删除工作项成功', type: 'success' });
      } else if (foundItem && foundItem.id.startsWith('temp-')) {
        // 如果是临时项（未保存到数据库），直接从前端删除
        console.log('删除临时工作项:', foundItem.id);
        const newItems = removeItem(workItems);
        setWorkItems(newItems);
        
        toast.add({ title: '删除工作项成功', type: 'success' });
      } else {
        // 无法确定工作项ID，可能是数据不一致
        console.error('无法删除工作项: 找不到有效的数据库ID', id);
        toast.add({ title: '删除失败：无法找到工作项', type: 'error' });
      }
    } catch (error) {
      console.error('删除工作项失败', error);
      toast.add({ title: `删除工作项失败: ${error instanceof Error ? error.message : '未知错误'}`, type: 'error' });
    } finally {
      // 重置状态
      setIsSaving(false);
      setItemToDelete(null);
    }
  };
  
  // 取消删除
  const cancelDeleteWorkItem = () => {
    setItemToDelete(null);
  };

  // 移动工作项
  const moveWorkItem = (item: WorkItem) => {
    // 只有已保存的工作项才能移动
    if (!item.dbId) {
      toast.add({ title: '请先保存工作项再进行移动', type: 'error' });
      return;
    }
    setItemToMove(item);
    setShowMoveDialog(true);
  };

  // 处理移动完成
  const handleMoveComplete = async () => {
    setShowMoveDialog(false);
    setItemToMove(null);

    // 重新加载工作项数据
    if (selectedProject && user) {
      try {
        setIsLoadingItems(true);
        const workItemsTree = await workBreakdownService.getWorkBreakdownItems(
          selectedProject.id
        );
        setWorkItems(workItemsTree);

        // 重新计算所有可能的移动目标
        const potentialParents = calculateAllPotentialParents(workItemsTree);
        setAllPotentialParents(potentialParents);
      } catch (error) {
        console.error('重新加载工作项失败:', error);
        toast.add({ title: '重新加载工作项失败', type: 'error' });
      } finally {
        setIsLoadingItems(false);
      }
    }
  };

  // 取消移动
  const cancelMoveWorkItem = () => {
    setShowMoveDialog(false);
    setItemToMove(null);
  };

  // 计算所有可能的移动目标
  const calculateAllPotentialParents = useCallback((workItemsTree: WorkItem[]) => {
    const flattenItems = (items: WorkItem[], result: any[] = []): any[] => {
      for (const item of items) {
        if (item.dbId && item.level < 4) { // 只有已保存且层级不超过3级的项目可以作为父级
          result.push({
            id: item.dbId,
            name: item.name,
            level: item.level,
            path: buildItemPathFromWorkItems(item.dbId, workItemsTree)
          });
        }

        // 递归处理子项
        if (item.children && item.children.length > 0) {
          flattenItems(item.children, result);
        }
      }
      return result;
    };

    return flattenItems(workItemsTree);
  }, []);

  // 从工作项树构建路径
  const buildItemPathFromWorkItems = (itemId: string, items: WorkItem[], parentPath: string = ''): string => {
    for (const item of items) {
      const currentPath = parentPath ? `${parentPath} > ${item.name}` : item.name;

      if (item.dbId === itemId) {
        return currentPath;
      }

      if (item.children && item.children.length > 0) {
        const childPath = buildItemPathFromWorkItems(itemId, item.children, currentPath);
        if (childPath) {
          return childPath;
        }
      }
    }
    return '';
  };

  // 处理拖拽结束事件
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // 找到被拖拽项和目标位置的父级容器
    const findItemAndParent = (items: WorkItem[], targetId: string, parent: WorkItem | null = null): { item: WorkItem; parent: WorkItem | null; siblings: WorkItem[] } | null => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.id === targetId) {
          return { item, parent, siblings: items };
        }
        if (item.children.length > 0) {
          const result = findItemAndParent(item.children, targetId, item);
          if (result) return result;
        }
      }
      return null;
    };

    const activeResult = findItemAndParent(workItems, active.id as string);
    const overResult = findItemAndParent(workItems, over.id as string);

    if (!activeResult || !overResult) {
      return;
    }

    // 只允许同级拖拽排序
    if (activeResult.parent?.id !== overResult.parent?.id) {
      toast.add({ title: '只能在同一层级内拖拽排序', type: 'error' });
      return;
    }

    const siblings = activeResult.siblings;
    const oldIndex = siblings.findIndex(item => item.id === active.id);
    const newIndex = siblings.findIndex(item => item.id === over.id);

    if (oldIndex === newIndex) {
      return;
    }

    // 更新前端状态
    const newSiblings = arrayMove(siblings, oldIndex, newIndex);

    // 更新position字段
    const positionUpdates: Array<{ id: string; position: number }> = [];
    newSiblings.forEach((item, index) => {
      if (item.dbId) {
        positionUpdates.push({ id: item.dbId, position: index });
      }
    });

    // 更新工作项树
    const updateWorkItemsTree = (items: WorkItem[]): WorkItem[] => {
      if (activeResult.parent === null) {
        // 根级别的排序
        return newSiblings;
      } else {
        // 子级别的排序
        return items.map(item => {
          if (item.id === activeResult.parent!.id) {
            return { ...item, children: newSiblings };
          }
          if (item.children.length > 0) {
            return { ...item, children: updateWorkItemsTree(item.children) };
          }
          return item;
        });
      }
    };

    const updatedWorkItems = updateWorkItemsTree(workItems);
    setWorkItems(updatedWorkItems);

    // 保存到数据库
    try {
      if (positionUpdates.length > 0) {
        await workBreakdownService.updateWorkItemPositions(positionUpdates);
        toast.add({ title: '排序已保存', type: 'success' });
      }
    } catch (error) {
      console.error('保存排序失败:', error);
      toast.add({ title: '保存排序失败', type: 'error' });
      // 恢复原始状态
      setWorkItems(workItems);
    }
  };

  // 工作状态徽章（唯一来源：lib/utils/status-colors）
  const renderStatusBadge = (status: string | undefined) => {
    if (!status) return null;

    const style = getWorkStatusStyle(status);
    return (
      <Badge variant={style.badgeVariant} className={cn('ml-2', style.badgeClassName)}>
        {status}
      </Badge>
    );
  };

  // 渲染工作项标签（带图标，各视图复用）
  const renderTags = (tags: string | undefined) => {
    if (!tags) return null;
    
    const tagList = tags.split('，').filter(Boolean);
    if (tagList.length === 0) return null;
    
    return (
      <div className="ml-2 mt-1 flex flex-wrap items-center gap-1 sm:mt-0">
        {tagList.map((tag, idx) => (
          <Badge variant="secondary" key={`tag-${idx}`}>
            {tag}
          </Badge>
        ))}
      </div>
    );
  };
  
  // 渲染工作项人员
  const renderMembers = (members: string | undefined, compact: boolean = false) => {
    if (!members) return null;
    
    const memberList = members.split('，').filter(Boolean);
    if (memberList.length === 0) return null;
    
    return (
      <>
        {memberList.map((member, idx) => (
          <Badge variant="secondary"
            key={`member-${idx}`} 
            className={cn(compact ? 'px-1.5 py-0.5' : 'px-2.5 py-1')}
          >
            {member}
          </Badge>
        ))}
      </>
    );
  };

  // 渲染工作项人员（带图标，各视图复用）
  const renderInlineMembers = (members: string | undefined) => {
    const content = renderMembers(members, true);
    if (!content) return null;

    return (
      <div className="ml-2 mt-1 flex flex-wrap items-center gap-1 sm:mt-0">
        {content}
      </div>
    );
  };

  // 渲染工作项描述
  const renderDescription = (description: string | undefined) => {
    if (!description) return null;

    return (
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {description}
      </div>
    );
  };

  // 渲染工作进展备注
  const renderProgressNotes = (progressNotes: string | undefined) => {
    if (!progressNotes) return null;

    return (
      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span>工作进展备注:</span>
        </div>
        <div className="rounded-md border border-border bg-muted p-2 text-sm whitespace-pre-wrap">
          {progressNotes}
        </div>
      </div>
    );
  };

  // 渲染工作项内容（列表统一视图：展示 + 进度，操作按钮由 SortableWorkItem 提供）
  const renderViewMode = (item: WorkItem) => {
    return (
      <div>
        <div className="flex grow flex-wrap items-center">
          {item.children.length > 0 && (
            <Button variant="ghost" size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(item.id);
              }}
              aria-label={item.isExpanded ? "折叠" : "展开"}
            >
              {item.isExpanded ? (
                <ChevronDownIcon />
              ) : (
                <ChevronRightIcon />
              )}
            </Button>
          )}
          <h3 className="font-medium text-lg">{item.name}</h3>

          {/* 显示工作状态徽章 */}
          {renderStatusBadge(item.status)}

          {/* 显示工作进度 */}
          <div className="ml-2">
            <ProgressIndicator
              progress={getItemProgress(item)}
              size="sm"
              showBar={true}
              showText={true}
            />
          </div>

          {/* 显示参与人员 */}
          {renderInlineMembers(item.members)}

          {/* 显示工作标签 */}
          {renderTags(item.tags)}
        </div>

        {/* 描述区域 */}
        {renderDescription(item.description)}

        {/* 工作进展备注 */}
        {renderProgressNotes(item.progress_notes)}
      </div>
    );
  };

  // 计算工作项进度的辅助函数
  const getItemProgress = (item: WorkItem): number => {
    return calculateWorkItemProgress({
      id: item.id,
      status: item.status,
      children: item.children?.map(child => ({
        id: child.id,
        status: child.status,
        children: child.children?.map(grandChild => ({
          id: grandChild.id,
          status: grandChild.status,
          children: grandChild.children?.map(greatGrandChild => ({
            id: greatGrandChild.id,
            status: greatGrandChild.status,
            children: greatGrandChild.children
          }))
        }))
      }))
    });
  };

  // 处理工作项点击选中
  const handleWorkItemClick = (item: WorkItem, e: React.MouseEvent) => {    // 阻止事件冒泡，避免触发展开/折叠
    e.stopPropagation();

    // 如果点击的是已选中的工作项，则取消选中
    if (selectedWorkItem?.id === item.id) {
      setSelectedWorkItem(null);
    } else {
      setSelectedWorkItem(item);
    }
  };

  // 根据选中的状态筛选工作项
  useEffect(() => {
    if (selectedStatuses.length === 0) {
      // 如果没有选择任何状态，显示所有工作项
      setFilteredWorkItems(workItems);
    } else {
      // 只保留符合筛选条件的工作项，不保留父级
      const filterItemsByStatus = (items: WorkItem[]): WorkItem[] => {
        const result: WorkItem[] = [];
        
        // 遍历每个工作项
        for (const item of items) {
          // 递归筛选子项
          const filteredChildren = filterItemsByStatus(item.children);
          
          // 如果当前项状态符合筛选条件
          if (selectedStatuses.includes(item.status || '未开始')) {
            // 添加当前项（带有筛选后的子项）
            result.push({
              ...item,
              children: filteredChildren
            });
          } else if (filteredChildren.length > 0) {
            // 如果当前项不符合条件但有符合条件的子项
            // 将符合条件的子项直接添加到结果中
            result.push(...filteredChildren);
          }
        }
        
        return result;
      };
      
      const filtered = filterItemsByStatus(workItems);
      setFilteredWorkItems(filtered);
    }
  }, [workItems, selectedStatuses]);

  // 处理状态筛选切换
  const handleStatusFilterToggle = (status: string) => {
    setSelectedStatuses(prev => {
      if (prev.includes(status)) {
        return prev.filter(s => s !== status);
      } else {
        return [...prev, status];
      }
    });
  };

  // 清除所有筛选条件
  const clearStatusFilters = () => {
    setSelectedStatuses([]);
  };
  
  // 设置工作项展开层级
  const handleExpandLevelChange = (level: number) => {
    setExpandLevel(level);
    
    // 更新所有工作项的展开状态
    const updateExpandState = (items: WorkItem[], currentLevel: number = 0): WorkItem[] => {
      return items.map(item => {
        const shouldExpand = currentLevel < level;
        return {
          ...item,
          isExpanded: shouldExpand,
          children: item.children.length > 0 ? updateExpandState(item.children, currentLevel + 1) : []
        };
      });
    };
    
    setWorkItems(updateExpandState(workItems));
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 删除确认对话框 */}
      <AlertDialog open={itemToDelete !== null} onOpenChange={(open) => { if (!open) cancelDeleteWorkItem(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要删除此工作项吗？此操作无法撤销，删除后将同时删除所有子工作项。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeleteWorkItem} disabled={isSaving}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDeleteWorkItem} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Spinner className="mr-2" />
                  删除中...
                </>
              ) : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 移动工作项对话框 */}
      <MoveWorkItemDialog
        isOpen={showMoveDialog}
        onClose={cancelMoveWorkItem}
        workItem={itemToMove}
        projectId={selectedProject?.id || ''}
        onMoveComplete={handleMoveComplete}
        potentialParents={allPotentialParents}
      />

      {/* 标题行 */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900 mb-4 sm:mb-0">
            {selectedProject ? `${selectedProject.name} 工作分解` : '工作分解'}
          </h1>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* 项目选择器 - 放在左侧 */}
          <div className="w-full sm:w-auto">
            <Field orientation="horizontal">
              <FieldLabel htmlFor="wb-project" className="whitespace-nowrap">项目</FieldLabel>
              <Select
                value={selectedProject?.id || ""}
                items={projects.map((project) => ({ label: project.name, value: project.id }))}
                onValueChange={(v) => {
                  const project = projects.find(p => p.id === (v ?? ''));
                  setSelectedProject(project || null);
                }}
                disabled={isLoading || isSaving}
              >
                <SelectTrigger id="wb-project" className="w-full">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {projects.map(project => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldError errors={[]} />
            </Field>
          </div>

          {/* 层级展开控制 */}
          {selectedProject && workItems.length > 0 && (
            <div className="relative">
              <Field orientation="horizontal">
                <FieldLabel htmlFor="wb-expand-level" className="whitespace-nowrap">展开层级</FieldLabel>
                <Select
                  value={String(expandLevel)}
                  onValueChange={(v) => handleExpandLevelChange(parseInt(v ?? '4'))}
                  items={[{ label: '仅展开1级', value: '0' }, { label: '展开到2级', value: '1' }, { label: '展开到3级', value: '2' }, { label: '展开到4级', value: '3' }, { label: '展开全部', value: '4' }]}
                >
                  <SelectTrigger id="wb-expand-level" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="0">仅展开1级</SelectItem>
                      <SelectItem value="1">展开到2级</SelectItem>
                      <SelectItem value="2">展开到3级</SelectItem>
                      <SelectItem value="3">展开到4级</SelectItem>
                      <SelectItem value="4">展开全部</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError errors={[]} />
              </Field>
            </div>
          )}
          
          {/* 工作状态筛选下拉菜单 */}
          {selectedProject && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-1")}
                  >
                    <ClockIcon className="h-4 w-4 mr-1" />
                    工作状态筛选
                    {selectedStatuses.length > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {selectedStatuses.length}
                      </Badge>
                    )}
                    <ChevronDownIcon className="h-4 w-4 ml-1" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>选择工作状态</DropdownMenuLabel>
                  {WORK_STATUS_OPTIONS.map(option => (
                    <DropdownMenuCheckboxItem
                      key={option.value}
                      checked={selectedStatuses.includes(option.value)}
                      onCheckedChange={() => handleStatusFilterToggle(option.value)}
                    >
                      <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${option.solidClassName}`}></span>
                      {option.value}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={clearStatusFilters}>
                    清除筛选条件
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          
          {/* 视图切换 - 放在右侧 */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 视图切换 */}
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="list">
                  <ListIcon className="h-4 w-4 mr-1" />
                  列表
                </TabsTrigger>
                <TabsTrigger value="map">
                  <NetworkIcon className="h-4 w-4 mr-1" />
                  工作导图
                </TabsTrigger>
                <TabsTrigger value="3d">
                  <OrbitIcon className="h-4 w-4 mr-1" />
                  3D世界
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>
      
      {/* 显示已选筛选条件 */}
      {selectedStatuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-blue-50 p-2 rounded-md border border-blue-100">
          <span className="text-xs text-blue-700">已筛选:</span>
          {selectedStatuses.map(status => (
            <Badge variant="secondary" className="gap-1 px-2 py-1 bg-white text-blue-700 border-blue-200"
              key={status}
            >
              {status}
              <Button variant="ghost" size="icon-xs"
                onClick={() => handleStatusFilterToggle(status)}
                aria-label="移除筛选"
                className="rounded-full p-0.5 text-blue-500"
              >
                <XIcon />
              </Button>
            </Badge>
          ))}
          <Button variant="link" size="sm"
            onClick={clearStatusFilters}
            className="text-blue-600 ml-2"
          >
            清除全部
          </Button>
          <span className="text-xs text-blue-700 ml-auto">
            注意：仅显示符合筛选条件的工作项
          </span>
        </div>
      )}
      
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Spinner className="size-10" />
          <span className="ml-3 text-gray-600">加载中...</span>
        </div>
      ) : (
        <div>
          {selectedProject ? (
            <div>
              {workItems.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {/* 项目进度统计概览（仅列表视图） */}
                  {(viewMode === 'list') && (
                    <Card className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                          <TrendingUpIcon className="h-5 w-5 mr-2 text-blue-600" />
                          {selectedWorkItem ? `${selectedWorkItem.name} 工作项进度概览` : '项目进度概览'}
                        </h3>
                        <div className="flex items-center gap-2">
                          {!selectedWorkItem && (
                            <Badge variant="secondary">
                              <LightbulbIcon data-icon="inline-start" />
                              点击工作项查看详细进度
                            </Badge>
                          )}
                          {selectedWorkItem && (
                            <Button variant="ghost" size="sm"
                              onClick={() => setSelectedWorkItem(null)}
                            >
                              返回项目概览
                            </Button>
                          )}
                        </div>
                      </div>

                      {(() => {
                        // 根据选中的工作项确定要统计的数据范围和计算进度
                        let itemsToAnalyze: WorkItem[];
                        let overallProgress: number;

                        if (selectedWorkItem) {
                          // 如果选中了工作项，直接使用该工作项的计算进度
                          overallProgress = getItemProgress(selectedWorkItem);

                          // 统计该工作项及其所有子项的状态分布
                          const collectAllChildren = (item: WorkItem): WorkItem[] => {
                            const result = [item];
                            if (item.children && Array.isArray(item.children) && item.children.length > 0) {
                              item.children.forEach(child => {
                                if (child) {
                                  result.push(...collectAllChildren(child));
                                }
                              });
                            }
                            return result;
                          };
                          itemsToAnalyze = collectAllChildren(selectedWorkItem);
                        } else {
                          // 如果没有选中工作项，计算项目整体进度
                          const currentItems = selectedStatuses.length > 0 ? filteredWorkItems : workItems;

                          // 收集所有层级的工作项（包括子项）
                          const collectAllItems = (items: WorkItem[]): WorkItem[] => {
                            const result: WorkItem[] = [];
                            items.forEach(item => {
                              if (item) {
                                result.push(item);
                                if (item.children && Array.isArray(item.children) && item.children.length > 0) {
                                  result.push(...collectAllItems(item.children));
                                }
                              }
                            });
                            return result;
                          };

                          itemsToAnalyze = Array.isArray(currentItems) ? collectAllItems(currentItems) : [];

                          // 计算顶级工作项的加权平均进度（复用各工作项的进度计算逻辑）
                          if (currentItems.length > 0) {
                            const totalProgress = currentItems.reduce((sum, item) => {
                              return sum + getItemProgress(item);
                            }, 0);
                            overallProgress = totalProgress / currentItems.length;
                          } else {
                            overallProgress = 0;
                          }
                        }

                        // 统计状态分布（用于显示各状态的数量）
                        const statusCounts = WORK_STATUS_OPTIONS.reduce((acc, option) => {
                          acc[option.value] = 0;
                          return acc;
                        }, {} as Record<string, number>);

                        // 统计工作项状态（不需要递归，因为itemsToAnalyze已经包含了所有需要统计的项）
                        if (Array.isArray(itemsToAnalyze)) {
                          itemsToAnalyze.forEach(item => {
                            if (item && typeof item === 'object') {
                              if (item.status && statusCounts.hasOwnProperty(item.status)) {
                                statusCounts[item.status]++;
                              } else {
                                statusCounts['未开始']++;
                              }
                            }
                          });
                        }
                        const totalCount = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);

                        return (
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                            {/* 整体进度 */}
                            <div className="col-span-2 sm:col-span-4 lg:col-span-2 bg-linear-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-200">
                              <div className="text-sm text-blue-700 mb-1">
                                {selectedWorkItem ? '工作项进度' : '整体进度'}
                              </div>
                              <ProgressIndicator
                                progress={overallProgress}
                                size="md"
                                showBar={true}
                                showText={true}
                              />
                              <div className="text-xs text-blue-600 mt-1">
                                共 {totalCount} 个工作项
                              </div>
                            </div>

                            {/* 各状态统计 */}
                            {WORK_STATUS_OPTIONS.map(option => (
                              <div key={option.value} className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                <div className="text-sm text-gray-700 mb-1">{option.value}</div>
                                <div className="text-2xl font-bold text-gray-900">{statusCounts[option.value]}</div>
                                <div className="text-xs text-gray-500">
                                  {totalCount > 0 ? Math.round((statusCounts[option.value] / totalCount) * 100) : 0}%
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </Card>
                  )}

                  {/* 3D 世界视图（SPA 内联，占满视口剩余高度） */}
                  {viewMode === '3d' ? (
                    <Suspense
                      fallback={(
                        <div className="flex h-[calc(100dvh-300px)] min-h-120 w-full items-center justify-center rounded-lg bg-[#050a18] sm:h-[calc(100dvh-250px)] lg:h-[calc(100dvh-225px)]">
                          <Spinner className="size-8 text-sky-400" />
                          <span className="ml-3 text-sm text-sky-200/80">正在构建 3D 世界…</span>
                        </div>
                      )}
                    >
                      <WorkBreakdown3DWorld
                        key={selectedProject.id}
                        workItems={selectedStatuses.length > 0 ? filteredWorkItems : workItems}
                        projectName={selectedProject.name}
                      />
                    </Suspense>
                  ) : viewMode === 'map' ? (
                    <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                      <Suspense fallback={<div className="text-sm text-gray-500">导图加载中...</div>}>
                        <WorkMap
                          workItems={selectedStatuses.length > 0 ? filteredWorkItems : workItems}
                          projectName={selectedProject.name}
                        />
                      </Suspense>
                    </div>
                  ) : (
                    <>
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={(selectedStatuses.length > 0 ? filteredWorkItems : workItems).map(item => item.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {(selectedStatuses.length > 0 ? filteredWorkItems : workItems).map(item => (
                            <SortableWorkItem
                              key={item.id}
                              item={item}
                              level={0}
                              selectedId={selectedWorkItem?.id ?? null}
                              isSaving={isSaving}
                              onSelect={handleWorkItemClick}
                              onEdit={(id: string) => { setDialogMode({ kind: 'edit', itemId: id }); setDialogOpen(true); }}
                              onAddChild={addChildWorkItem}
                              onDelete={(id: string) => setItemToDelete(id)}
                              onMove={moveWorkItem}
                              renderBody={renderViewMode}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>

                      {/* 底部添加一级工作项按钮 */}
                      <div className="mt-8 flex justify-center">
                        <Button
                          onClick={addRootWorkItem}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <>
                              <Spinner data-icon="inline-start" />
                              处理中...
                            </>
                          ) : (
                            <>
                              <PlusIcon data-icon="inline-start" />
                              添加1级工作项
                            </>
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <Card className="p-10 text-center">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>当前项目没有工作分解项</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                  <Button
                    onClick={addRootWorkItem}
                    disabled={isSaving}
                  >
                      {isSaving ? (
                        <>
                          <Spinner data-icon="inline-start" />
                          处理中...
                        </>
                      ) : (
                        <>
                          <PlusIcon data-icon="inline-start" />
                          添加1级工作项
                        </>
                      )}
                    </Button>
                </Card>
              )}
            </div>
          ) : (
            <Card className="p-10 text-center">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>没有可用的活跃项目</EmptyTitle>
                </EmptyHeader>
              </Empty>
              <Button render={<a href="/dashboard/projects" />}>
                <PlusIcon data-icon="inline-start" />
                创建新项目
              </Button>
            </Card>
          )}
        </div>
      )}

      {/* 新建/编辑工作项对话框 */}
      <WorkItemDialog
        open={dialogOpen}
        title={dialogTitle}
        initial={dialogInitial}
        isSaving={isSaving}
        onOpenChange={setDialogOpen}
        onSave={handleDialogSave}
      />
    </div>
  );
}