import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Field, FieldError, FieldLabel } from "../components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import { WorkItem } from "../lib/services/work-breakdown";
import { workBreakdownService } from "../lib/services/work-breakdown";
import { toast } from "@/components/ui/toast";
import { MoveIcon, AlertTriangleIcon } from "lucide-react";

interface MoveWorkItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workItem: WorkItem | null;
  projectId: string;
  onMoveComplete: () => void;
  potentialParents?: PotentialParent[]; // 预先计算好的可选父级列表
}

interface PotentialParent {
  id: string;
  name: string;
  level: number;
  path: string;
}

export default function MoveWorkItemDialog({
  isOpen,
  onClose,
  workItem,
  projectId,
  onMoveComplete,
  potentialParents: propsParents = [],
}: MoveWorkItemDialogProps) {
  const [moveType, setMoveType] = useState<"root" | "parent">("root");
  const [selectedParentId, setSelectedParentId] = useState<string>("");
  const [potentialParents, setPotentialParents] = useState<PotentialParent[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingParents, setIsLoadingParents] = useState(false);

  // 加载可选的父级工作项
  useEffect(() => {
    if (isOpen && workItem) {
      if (propsParents.length > 0) {
        // 如果传入了预先计算的父级列表，直接使用并过滤
        const filteredParents = propsParents.filter(
          (parent) => parent.id !== workItem.dbId, // 排除自己
        );
        setPotentialParents(filteredParents);
        setIsLoadingParents(false);
      } else if (projectId) {
        // 如果没有传入父级列表，则进行请求
        loadPotentialParents();
      }
    }
  }, [isOpen, workItem, projectId, propsParents]);

  const loadPotentialParents = async () => {
    if (!workItem?.dbId) return;

    setIsLoadingParents(true);
    try {
      const parents = await workBreakdownService.getPotentialParents(
        projectId,
        workItem.dbId,
      );
      setPotentialParents(parents);
    } catch (error) {
      console.error("加载可选父级失败:", error);
      toast.add({ title: "加载可选父级失败", type: 'error' });
    } finally {
      setIsLoadingParents(false);
    }
  };

  const handleMove = async () => {
    if (!workItem?.dbId) {
      toast.add({ title: "工作项信息不完整", type: 'error' });
      return;
    }

    if (moveType === "parent" && !selectedParentId) {
      toast.add({ title: "请选择目标父级工作项", type: 'error' });
      return;
    }

    setIsLoading(true);
    try {
      const newParentId = moveType === "root" ? null : selectedParentId;
      await workBreakdownService.moveWorkItem(workItem.dbId, newParentId);

      toast.add({ title: "工作项移动成功", type: 'success' });
      onMoveComplete();
      onClose();
    } catch (error) {
      console.error("移动工作项失败:", error);
      toast.add({ title: error instanceof Error ? error.message : "移动工作项失败", type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setMoveType("root");
      setSelectedParentId("");
      onClose();
    }
  };

  const getPreviewInfo = () => {
    if (moveType === "root") {
      return {
        level: "1",
        position: "在1级工作项的末尾",
      };
    } else if (selectedParentId) {
      const parent = potentialParents.find((p) => p.id === selectedParentId);
      if (parent) {
        return {
          level: `${parent.level + 2}`,
          position: `在"${parent.name}"下的末尾`,
        };
      }
    }
    return {
      level: "未知",
      position: "未知",
    };
  };

  const previewInfo = getPreviewInfo();

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-visible">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MoveIcon className="size-5" />
            移动工作项
          </DialogTitle>
          <DialogDescription>选择移动为一级，或挂到目标父级下，预览确认层级后再提交。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          {/* 当前工作项信息 */}
          <div className="rounded-lg bg-muted p-3">
            <div className="mb-1 text-sm text-muted-foreground">
              当前工作项：
            </div>
            <div className="font-medium">{workItem?.name}</div>
            <div className="text-sm text-muted-foreground">
              当前层级：{workItem ? workItem.level + 1 : 0}级
            </div>
          </div>

          {/* 移动选项 */}
          <Field>
            <FieldLabel>选择移动目标：</FieldLabel>

            <RadioGroup
              value={moveType}
              onValueChange={(value) => setMoveType(value as "root" | "parent")}
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="root" id="root" />
                <FieldLabel htmlFor="root">移动为1级工作项</FieldLabel>
              </Field>

              <Field orientation="horizontal">
                <RadioGroupItem value="parent" id="parent" />
                <FieldLabel htmlFor="parent">移动到其他工作项下</FieldLabel>
              </Field>
            </RadioGroup>

            {/* 父级选择 */}
            {moveType === "parent" && (
              <div className="flex flex-col gap-2">
                {isLoadingParents ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    加载可选父级...
                  </div>
                ) : potentialParents.length > 0 ? (
                  <Select
                    value={selectedParentId}
                    onValueChange={(v) => setSelectedParentId(v ?? "")}
                    items={potentialParents.map((p) => ({
                      label: p.name,
                      value: p.id,
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择目标父级工作项">
                        {selectedParentId &&
                          (() => {
                            const selectedParent = potentialParents.find(
                              (p) => p.id === selectedParentId,
                            );
                            return selectedParent ? (
                              <div className="flex w-full items-center justify-between">
                                <span className="mr-2 flex-1 truncate">
                                  {selectedParent.name}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 whitespace-nowrap"
                                >
                                  {selectedParent.level + 1}级
                                </Badge>
                              </div>
                            ) : null;
                          })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      className="max-h-50"
                      side="bottom"
                      align="start"
                      sideOffset={4}
                    >
                      <SelectGroup>
                        {potentialParents.map((parent) => (
                          <SelectItem
                            key={parent.id}
                            value={parent.id}
                            className="p-2 cursor-pointer"
                          >
                            <div className="flex w-full min-w-0 flex-col">
                              <div className="flex w-full items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm leading-tight font-medium wrap-break-word">
                                    {parent.name}
                                  </div>
                                  <div className="mt-1 text-xs leading-tight wrap-break-word text-muted-foreground">
                                    {parent.path}
                                  </div>
                                </div>
                                <Badge
                                  variant="secondary"
                                  className="mt-0.5 shrink-0 whitespace-nowrap"
                                >
                                  {parent.level + 1}级
                                </Badge>
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Alert className="border-warning/30 bg-warning/10 text-warning">
                    <AlertTriangleIcon />
                    <AlertTitle>没有可选的父级工作项</AlertTitle>
                  </Alert>
                )}
              </div>
            )}
            <FieldError errors={[]} />
          </Field>

          {/* 预览信息 */}
          <div className="rounded-lg bg-accent p-3">
            <div className="mb-2 text-sm font-medium text-primary">
              移动预览：
            </div>
            <div className="flex flex-col gap-2 text-sm text-primary">
              <div className="flex items-center gap-2">
                <span>移动后层级：</span>
                {previewInfo.level !== "未知" ? (
                  <Badge variant="secondary">第{previewInfo.level}级</Badge>
                ) : (
                  <span className="text-muted-foreground">未知</span>
                )}
              </div>
              <div>移动后位置：{previewInfo.position}</div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            取消
          </Button>
          <Button
            onClick={handleMove}
            disabled={isLoading || (moveType === "parent" && !selectedParentId)}
          >
            {isLoading && <Spinner data-icon="inline-start" />}
            确认移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
