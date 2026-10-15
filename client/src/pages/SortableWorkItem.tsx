import React from 'react';
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { WorkItem } from '../lib/services/work-breakdown';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  GripVerticalIcon,
  MoveIcon
} from 'lucide-react';

interface SortableWorkItemProps {
  item: WorkItem;
  level: number;
  selectedId: string | null;
  isSaving: boolean;
  onSelect: (item: WorkItem, e: React.MouseEvent) => void;
  onEdit: (id: string) => void;
  onAddChild: (parentId: string, level: number) => void;
  onDelete: (id: string) => void;
  onMove: (item: WorkItem) => void;
  renderBody: (item: WorkItem, level: number) => React.ReactNode;
}

export function SortableWorkItem({
  item,
  level,
  selectedId,
  isSaving,
  onSelect,
  onEdit,
  onAddChild,
  onDelete,
  onMove,
  renderBody
}: SortableWorkItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // 获取同级的子项ID列表
  const childrenIds = item.children.map(child => child.id);
  const canAddChildren = level < 4;
  const isSelected = selectedId === item.id;

  return (
    <div ref={setNodeRef} style={style} className="mb-4">
      <Card
        onClick={(e) => onSelect(item, e)}
        className={cn(
          'flex-row cursor-pointer items-start border-l-4 px-4 transition-all',
          isSelected
            ? 'bg-accent shadow-md ring-2 ring-primary/30'
            : 'hover:shadow-md',
          level === 0 ? 'border-l-primary' :
          level === 1 ? 'border-l-success' :
          level === 2 ? 'border-l-warning' :
          level === 3 ? 'border-l-chart-4' :
          'border-l-destructive'
        )}
      >
        {/* 拖拽手柄（dnd-kit 的 listeners/attributes 直接落在原生 button 上，绕开 ui 组件无 forwardRef 的限制） */}
        <Tooltip>
          <TooltipTrigger
            {...attributes}
            {...listeners}
            aria-label="拖拽排序"
            className={cn('mt-1 inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing')}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVerticalIcon />
          </TooltipTrigger>
          <TooltipContent>拖拽排序</TooltipContent>
        </Tooltip>

        <div className="min-w-0 grow">
          {renderBody(item, level)}

          {/* 操作按钮 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onEdit(item.id); }}
              disabled={isSaving}
            >
              <PencilIcon data-icon="inline-start" />
              编辑
            </Button>

            {canAddChildren && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onAddChild(item.id, level); }}
                disabled={isSaving}
              >
                <PlusIcon data-icon="inline-start" />
                添加{level + 2}级工作项
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onMove(item); }}
              disabled={isSaving || !item.dbId}
              title={!item.dbId ? "请先保存工作项再进行移动" : "移动层级"}
            >
              <MoveIcon data-icon="inline-start" />
              移动层级
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
              disabled={isSaving}
            >
              <TrashIcon data-icon="inline-start" />
              删除
            </Button>
          </div>
        </div>
      </Card>

      {/* 子项渲染 */}
      {item.children.length > 0 && item.isExpanded && (
        <div className={cn('mt-3 pl-8', level < 4 && 'border-l border-border')}>
          <SortableContext items={childrenIds} strategy={verticalListSortingStrategy}>
            {item.children.map(child => (
              <SortableWorkItem
                key={child.id}
                item={child}
                level={level + 1}
                selectedId={selectedId}
                isSaving={isSaving}
                onSelect={onSelect}
                onEdit={onEdit}
                onAddChild={onAddChild}
                onDelete={onDelete}
                onMove={onMove}
                renderBody={renderBody}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
