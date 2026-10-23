import { useEffect, useState, useMemo } from "react";
import { apiDelete, apiGet, apiPut } from "../lib/api";
import { useAuth } from "../contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import { SearchIcon, UsersIcon, UserCheckIcon, UserPlusIcon, UserCogIcon, InboxIcon } from "lucide-react";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: string[];
  project_count: number;
  daily_count: number;
  last_report_edit: string | null; // 修改为最近日报编辑时间
  is_active: boolean;
}

// 定义数据类型
interface UserProfile {
  id: string;
  full_name?: string;
  email: string;
  role?: string[];
  last_report_edit_at?: string;
}

const STAT_CARDS = [
  { key: 'total', label: '用户总数', icon: UsersIcon },
  { key: 'active', label: '活跃用户', icon: UserCheckIcon },
  { key: 'mau', label: '月活用户', icon: UserPlusIcon },
  { key: 'wau', label: '7日活跃', icon: UserCogIcon },
] as const;

export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    mau: 0,
    wau: 0
  });
  // 角色变更确认框目标
  const [roleTarget, setRoleTarget] = useState<{ id: string; email: string; isAdmin: boolean } | null>(null);
  // 对话框内的角色选择值（'user' | 'admin'），打开时初始化为当前值
  const [roleEditValue, setRoleEditValue] = useState<'user' | 'admin'>('user');
  const [roleError, setRoleError] = useState<string | null>(null);
  // 删除确认框目标
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      // 管理员总览（服务端聚合，避免全表拉取）
      const data = await apiGet<{
        users: UserProfile[];
        projectCounts: Record<string, number>;
        reportCounts: Record<string, number>;
      }>('/api/admin/overview');

      const userList = data.users || [];
      console.log("用户数据:", userList);

      // 活跃用户统计
      const now = new Date();
      const monthAgo = new Date();
      monthAgo.setDate(now.getDate() - 30);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);

      // 统计
      let active = 0, mau = 0, wau = 0;
      const userRows = userList.map((u) => {
        const project_count = data.projectCounts?.[u.id] || 0;
        const daily_count = data.reportCounts?.[u.id] || 0;

        // 使用last_report_edit_at判断活跃状态
        console.log(`用户 ${u.email} 的最近日报编辑时间:`, u.last_report_edit_at);

        let lastReportEdit = null;
        try {
          if (u.last_report_edit_at) {
            lastReportEdit = new Date(u.last_report_edit_at);
            console.log(`解析后的日期对象:`, lastReportEdit);
          }
        } catch (e) {
          console.error(`解析日期失败:`, e);
        }

        if (lastReportEdit) active++;
        if (lastReportEdit && lastReportEdit >= monthAgo) mau++;
        if (lastReportEdit && lastReportEdit >= sevenDaysAgo) wau++;

        // 尝试获取最后一次日报编辑时间
        let lastEditDate = null;
        try {
          if (u.last_report_edit_at) {
            lastEditDate = new Date(u.last_report_edit_at).toLocaleString();
          }
        } catch (e) {
          console.error(`处理日期显示失败:`, e);
          lastEditDate = '日期处理错误';
        }

        return {
          id: u.id,
          full_name: u.full_name || u.email?.split("@")?.[0] || "用户",
          email: u.email,
          role: Array.isArray((u as { role?: unknown }).role) ? (u.role as string[]) : ['user'],
          project_count,
          daily_count,
          last_report_edit: lastEditDate, // 使用处理后的日期
          is_active: !!lastReportEdit // 只根据最近日报编辑时间判断活跃状态
        };
      });

      console.log("处理后的用户数据:", userRows);

      setStats({
        total: userList.length,
        active,
        mau,
        wau
      });
      setUsers(userRows);
    } catch (error) {
      console.error("获取数据失败:", error);
    } finally {
      setLoading(false);
    }
  }

  // 排序+搜索过滤：先按日报数量降序，再按搜索
  const filteredUsers = useMemo(() => {
    let sorted = [...users].sort((a, b) => b.daily_count - a.daily_count);
    if (!search) return sorted;
    return sorted.filter(u => u.full_name.toLowerCase().includes(search.toLowerCase()));
  }, [users, search]);

  const isSelf = (id: string) => currentUser?.id === id;
  const isAdminUser = (u: UserRow) => u.role.includes('admin');

  // 打开角色编辑框（选择值初始化为当前角色，保证幂等）
  const openRoleEditor = (u: UserRow) => {
    setRoleEditValue(isAdminUser(u) ? 'admin' : 'user');
    setRoleError(null);
    setRoleTarget({ id: u.id, email: u.email, isAdmin: isAdminUser(u) });
  };

  // 当前选择与原角色是否一致（一致则禁用确认按钮，避免无效提交）
  const roleUnchanged =
    !roleTarget || (roleEditValue === 'admin') === roleTarget.isAdmin;

  // 确认角色变更（仅在有变化时提交）
  const confirmRoleChange = async () => {
    if (!roleTarget || acting || roleUnchanged) return;
    setRoleError(null);
    setActing(true);
    try {
      const makeAdmin = roleEditValue === 'admin';
      await apiPut(`/api/admin/users/${roleTarget.id}`, {
        role: makeAdmin ? ['admin', 'user'] : ['user'],
      });
      toast.add({ title: makeAdmin ? `已将 ${roleTarget.email} 设为管理员` : `已将 ${roleTarget.email} 降为普通用户`, type: 'success' });
      setRoleTarget(null);
      await fetchData();
    } catch (error) {
      console.error('更新角色失败:', error);
      setRoleError(error instanceof Error ? error.message : '更新角色失败');
    } finally {
      setActing(false);
    }
  };

  // 确认删除用户（级联清理其全部数据）
  const confirmDeleteUser = async () => {
    if (!deleteTarget || acting) return;
    setDeleteError(null);
    setActing(true);
    try {
      const data = await apiDelete<{ message?: string }>(`/api/admin/users/${deleteTarget.id}`);
      toast.add({ title: data.message || '用户已删除', type: 'success' });
      setDeleteTarget(null);
      await fetchData();
    } catch (error) {
      console.error('删除用户失败:', error);
      setDeleteError(error instanceof Error ? error.message : '删除用户失败');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : (
          STAT_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.key}>
                <CardContent className="flex items-center gap-3">
                  <Icon className="size-7 text-primary" />
                  <div>
                    <div className="text-xs text-muted-foreground">{card.label}</div>
                    <div className="text-xl font-semibold">{stats[card.key]}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      {/* 搜索框 */}
      <InputGroup className="max-w-xs">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="搜索用户名称..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </InputGroup>
      {/* 用户列表 */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">名称</TableHead>
              <TableHead className="w-56">邮箱</TableHead>
              <TableHead className="w-20 text-center">项目数</TableHead>
              <TableHead className="w-20 text-center">日报数</TableHead>
              <TableHead className="w-36 text-center">最近日报编辑</TableHead>
              <TableHead className="w-20 text-center">状态</TableHead>
              <TableHead className="w-24 text-center">角色</TableHead>
              <TableHead className="w-44 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <>
                {[0, 1, 2].map((i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <InboxIcon />
                      </EmptyMedia>
                      <EmptyTitle>暂无数据</EmptyTitle>
                      <EmptyDescription>没有符合条件的用户</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium whitespace-nowrap">{u.full_name}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {u.email}
                  </TableCell>
                  <TableCell className="text-center">{u.project_count}</TableCell>
                  <TableCell className="text-center font-semibold text-primary">{u.daily_count}</TableCell>
                  <TableCell className="text-center">{u.last_report_edit || '-'}</TableCell>
                  <TableCell className="text-center">
                    {u.is_active ? (
                      <Badge>活跃</Badge>
                    ) : (
                      <Badge variant="secondary">未活跃</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {isAdminUser(u) ? (
                      <Badge>管理员</Badge>
                    ) : (
                      <Badge variant="outline">普通用户</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSelf(u.id)}
                        title={isSelf(u.id) ? '不能修改自己的角色' : '编辑用户角色'}
                        onClick={() => openRoleEditor(u)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isSelf(u.id)}
                        title={isSelf(u.id) ? '不能删除自己' : '删除该用户及其全部数据'}
                        onClick={() => setDeleteTarget({ id: u.id, email: u.email })}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 角色编辑框：下拉选择目标角色，与当前一致时禁用确认 */}
      <Dialog open={!!roleTarget} onOpenChange={(open) => { if (!open) { setRoleTarget(null); setRoleError(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑用户角色</DialogTitle>
            <DialogDescription>
              为 {roleTarget?.email} 选择角色，保存后实时生效。
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="role-select">角色</FieldLabel>
            <Select value={roleEditValue} onValueChange={(v) => setRoleEditValue(v as 'user' | 'admin')} items={[{ label: '普通用户', value: 'user' }, { label: '管理员', value: 'admin' }]}>
              <SelectTrigger id="role-select" className="w-full">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="user">普通用户</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {roleUnchanged && (
              <FieldDescription>与当前角色一致，无需保存。</FieldDescription>
            )}
            <FieldError errors={roleError ? [{ message: roleError }] : []} />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRoleTarget(null)}
              disabled={acting}
            >
              取消
            </Button>
            <Button
              onClick={confirmRoleChange}
              disabled={acting || roleUnchanged}
              title={roleUnchanged ? '角色未变化' : '保存角色'}
            >
              {acting ? '保存中...' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除用户确认框（危险操作） */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除用户？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除 {deleteTarget?.email} 的账号及其全部数据（项目、日报、待办、工作分解、分享、AI 设置等），不可恢复，请慎重确认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <Field>
              <FieldError errors={[{ message: deleteError }]} />
            </Field>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDeleteUser} disabled={acting}>
              {acting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
