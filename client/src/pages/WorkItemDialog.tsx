import { useState, useEffect } from "react";
import { SaveIcon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { apiGet } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { WORK_STATUS_OPTIONS } from "../lib/utils/status-colors";

export interface WorkItemDialogFields {
  name: string;
  description: string;
  status: string;
  tags: string;
  members: string;
  progressNotes: string;
}

interface WorkItemDialogProps {
  open: boolean;
  title: string;
  initial: WorkItemDialogFields;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (fields: WorkItemDialogFields) => void;
}

// 工作标签选项
const TAG_OPTIONS = [
  '需求对接', '产品设计', 'UI 设计', '前端开发', '后端开发',
  '前后端联调', '功能测试', '功能确认', 'BUG 处理',
  '数据开发', '基础资源', '数据资源'
];

// 多选 combobox（工作标签 / 参与人员共用）：chips 展示已选 + 输入过滤。
// allowCreate=true（标签）：回车/逗号可新增任意文本；
// allowCreate=false（人员）：只能从 presets（数据库真实用户）里选，回车仅精确匹配选中。
function MultiSelectCombobox({
  initialValue,
  onValueChange,
  presets,
  placeholder,
  emptyText,
  allowCreate = true,
}: {
  initialValue: string;
  onValueChange: (value: string) => void;
  presets: string[];
  placeholder: string;
  emptyText: string;
  allowCreate?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(
    () => (initialValue ? initialValue.split('，').filter(Boolean) : []),
  );
  const [options, setOptions] = useState<string[]>(presets);
  const [query, setQuery] = useState('');
  const anchor = useComboboxAnchor();

  // presets 异步到达后同步（如人员列表来自接口）
  useEffect(() => {
    setOptions(presets);
  }, [presets]);

  // 受控回传父组件
  useEffect(() => {
    onValueChange(selected.join('，'));
  }, [selected, onValueChange]);

  const selectText = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setSelected((prev) => (prev.includes(text) ? prev : [...prev, text]));
  };

  const addText = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    if (!options.includes(text)) {
      setOptions((prev) => [...prev, text]);
    }
    selectText(text);
  };

  // 输入以逗号结尾时直接新增（仅 allowCreate，兼容旧输入习惯）
  const handleInputValueChange = (value: string) => {
    if (allowCreate && (value.endsWith('，') || value.endsWith(','))) {
      const text = value.slice(0, -1).trim();
      if (text) addText(text);
      setQuery('');
      return;
    }
    setQuery(value);
  };

  // 回车：allowCreate 则选中/新增输入文本；否则仅精确匹配选项时选中
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !query.trim()) return;
    const text = query.trim();
    if (allowCreate) {
      e.preventDefault();
      addText(text);
      setQuery('');
      return;
    }
    if (options.includes(text) && !selected.includes(text)) {
      e.preventDefault();
      selectText(text);
      setQuery('');
    }
  };

  return (
    <Combobox
      multiple
      value={selected}
      onValueChange={(v) => setSelected(v)}
      inputValue={query}
      onInputValueChange={handleInputValueChange}
      items={options}
      filter={(item: string, q: string) => item.toLowerCase().includes(q.toLowerCase())}
    >
      <div ref={anchor}>
        <ComboboxChips>
          <ComboboxValue>
            {(values: string[]) => values.map((v) => <ComboboxChip key={v}>{v}</ComboboxChip>)}
          </ComboboxValue>
          <ComboboxChipsInput
            placeholder={selected.length > 0 ? undefined : placeholder}
            onKeyDown={handleKeyDown}
          />
        </ComboboxChips>
      </div>
      <ComboboxContent anchor={anchor}>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}

export default function WorkItemDialog({ open, title, initial, isSaving, onOpenChange, onSave }: WorkItemDialogProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState(initial.status);
  const [tags, setTags] = useState(initial.tags);
  const [members, setMembers] = useState(initial.members);
  const [progressNotes, setProgressNotes] = useState(initial.progressNotes);
  const [nameError, setNameError] = useState<string | null>(null);
  // 每次打开递增，强制标签/人员 combobox 重新挂载，避免内部 state 残留上次的值
  const [session, setSession] = useState(0);
  // 数据库真实用户列表（参与人员只能从中选择，不可自由输入）
  const [memberOptions, setMemberOptions] = useState<string[]>([]);

  // 弹窗打开时用最新 initial 重置表单，并拉取用户列表
  useEffect(() => {
    if (open) {
      setName(initial.name);
      setDescription(initial.description);
      setStatus(initial.status);
      setTags(initial.tags);
      setMembers(initial.members);
      setProgressNotes(initial.progressNotes);
      setNameError(null);
      setSession((s) => s + 1);
      apiGet<{ users: Array<{ id: string; full_name: string | null; email: string }> }>('/api/users')
        .then((d) => setMemberOptions(Array.from(new Set(d.users.map((u) => u.full_name || u.email)))))
        .catch(() => setMemberOptions([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = () => {
    if (!name.trim()) {
      setNameError('工作项名称不能为空');
      toast.add({ title: '工作项名称不能为空', type: 'error' });
      return;
    }
    setNameError(null);
    onSave({ name: name.trim(), description, status, tags, members, progressNotes });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>填写工作项的基本信息与进展</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 grow flex-col gap-4 overflow-auto p-1">
          <Field>
            <FieldLabel htmlFor="work-item-name">
              工作项名称
            </FieldLabel>
            <Input
              id="work-item-name"
              value={name}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError(null); }}
              placeholder="工作项名称"
              aria-invalid={!!nameError}
            />
            <FieldError errors={nameError ? [{ message: nameError }] : []} />
          </Field>

          <Field>
            <FieldLabel htmlFor="work-item-desc">
              工作描述
            </FieldLabel>
            <Textarea
              id="work-item-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="工作描述（可选）"
              rows={3}
            />
            <FieldError errors={[]} />
          </Field>

          {/* 工作进展状态选择 */}
          <Field>
            <FieldLabel htmlFor="work-item-status">
              工作进展
            </FieldLabel>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v ?? '未开始')}
              items={WORK_STATUS_OPTIONS.map((o) => ({ label: o.value, value: o.value }))}
            >
              <SelectTrigger id="work-item-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {WORK_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.value}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError errors={[]} />
          </Field>

          {/* 工作进展备注 */}
          <Field>
            <FieldLabel htmlFor="work-item-progress-notes">
              工作进展备注
            </FieldLabel>
            <Textarea
              id="work-item-progress-notes"
              value={progressNotes}
              onChange={(e) => setProgressNotes(e.target.value)}
              placeholder="记录工作进展的详细情况、遇到的问题等（可选）"
              rows={3}
            />
            <FieldError errors={[]} />
          </Field>

          {/* 工作标签输入 */}
          <Field>
            <FieldLabel>
              工作标签
            </FieldLabel>
            <MultiSelectCombobox
              key={`tags-${session}`}
              initialValue={initial.tags}
              onValueChange={setTags}
              presets={TAG_OPTIONS}
              placeholder="输入标签并按回车添加"
              emptyText="无匹配标签，回车可直接添加"
            />
            <FieldError errors={[]} />
          </Field>

          {/* 参与人员输入 */}
          <Field>
            <FieldLabel>
              参与人员
            </FieldLabel>
            <MultiSelectCombobox
              key={`members-${session}`}
              initialValue={initial.members}
              onValueChange={setMembers}
              presets={memberOptions}
              allowCreate={false}
              placeholder="选择参与人员"
              emptyText="无匹配人员，仅可选择已有用户"
            />
            <FieldError errors={[]} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            取消
          </Button>
          <Button size="sm"
            type="button"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Spinner data-icon="inline-start" />
                保存中...
              </>
            ) : (
              <>
                <SaveIcon data-icon="inline-start" />
                保存
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
