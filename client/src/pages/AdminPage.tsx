import { useEffect, useState, useMemo } from "react";
import { apiDelete, apiGet, apiPut } from "../lib/api";
import { useAuth } from "../contexts/auth-context";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { toast } from "sonner";
import { Loader2, SearchIcon, UsersIcon, UserCheckIcon, UserPlusIcon, UserCogIcon } from "lucide-react";

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

interface Project {
  id: string;
  user_id: string;
}

interface DailyReport {
  id: string;
  user_id: string;
  created_at: string;
}

interface RecentReport {
  id: string;
  user_id: string;
  updated_at: string;
}

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
  // 删除确认框目标
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email: string } | null>(null);
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
    setRoleTarget({ id: u.id, email: u.email, isAdmin: isAdminUser(u) });
  };

  // 当前选择与原角色是否一致（一致则禁用确认按钮，避免无效提交）
  const roleUnchanged =
    !roleTarget || (roleEditValue === 'admin') === roleTarget.isAdmin;

  // 确认角色变更（仅在有变化时提交）
  const confirmRoleChange = async () => {
    if (!roleTarget || acting || roleUnchanged) return;
    setActing(true);
    try {
      const makeAdmin = roleEditValue === 'admin';
      await apiPut(`/api/admin/users/${roleTarget.id}`, {
        role: makeAdmin ? ['admin', 'user'] : ['user'],
      });
      toast.success(makeAdmin ? `已将 ${roleTarget.email} 设为管理员` : `已将 ${roleTarget.email} 降为普通用户`);
      setRoleTarget(null);
      await fetchData();
    } catch (error) {
      console.error('更新角色失败:', error);
      toast.error(error instanceof Error ? error.message : '更新角色失败');
    } finally {
      setActing(false);
    }
  };

  // 确认删除用户（级联清理其全部数据）
  const confirmDeleteUser = async () => {
    if (!deleteTarget || acting) return;
    setActing(true);
    try {
      const data = await apiDelete<{ message?: string }>(`/api/admin/users/${deleteTarget.id}`);
      toast.success(data.message || '用户已删除');
      setDeleteTarget(null);
      await fetchData();
    } catch (error) {
      console.error('删除用户失败:', error);
      toast.error(error instanceof Error ? error.message : '删除用户失败');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <UserCogIcon className="w-6 h-6 text-blue-600" /> 系统管理
      </h1>
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-3">
          <UsersIcon className="w-7 h-7 text-blue-500" />
          <div>
            <div className="text-xs text-gray-500">用户总数</div>
            <div className="text-xl font-bold">{stats.total}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-3">
          <UserCheckIcon className="w-7 h-7 text-green-500" />
          <div>
            <div className="text-xs text-gray-500">活跃用户</div>
            <div className="text-xl font-bold">{stats.active}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-3">
          <UserPlusIcon className="w-7 h-7 text-purple-500" />
          <div>
            <div className="text-xs text-gray-500">月活用户</div>
            <div className="text-xl font-bold">{stats.mau}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-3">
          <UserCogIcon className="w-7 h-7 text-orange-500" />
          <div>
            <div className="text-xs text-gray-500">7日活跃</div>
            <div className="text-xl font-bold">{stats.wau}</div>
          </div>
        </div>
      </div>
      {/* 搜索框 */}
      <div className="flex items-center mb-4 gap-2">
        <div className="relative w-full max-w-xs">
          <Input
            placeholder="搜索用户名称..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
          <SearchIcon className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
        </div>
      </div>
      {/* 用户列表 */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-600 w-32">名称</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-600 w-56">邮箱</th>
              <th className="px-4 py-2 text-center font-semibold text-gray-600 w-20">项目数</th>
              <th className="px-4 py-2 text-center font-semibold text-gray-600 w-20">日报数</th>
              <th className="px-4 py-2 text-center font-semibold text-gray-600 w-36">最近日报编辑</th> {/* 修改列标题 */}
              <th className="px-4 py-2 text-center font-semibold text-gray-600 w-20">状态</th>
              <th className="px-4 py-2 text-center font-semibold text-gray-600 w-24">角色</th>
              <th className="px-4 py-2 text-center font-semibold text-gray-600 w-44">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500" />
                  <div className="text-xs text-gray-400 mt-2">加载中...</div>
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-400">暂无数据</td>
              </tr>
            ) : (
              filteredUsers.map((u, idx) => (
                <tr key={u.id} className={idx % 2 === 0 ? "bg-white hover:bg-blue-50" : "bg-gray-50 hover:bg-blue-50"}>
                  <td className="px-4 py-2 whitespace-nowrap font-medium text-gray-900">{u.full_name}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {u.email}
                  </td>
                  <td className="px-4 py-2 text-center">{u.project_count}</td>
                  <td className="px-4 py-2 text-center font-bold text-blue-700">{u.daily_count}</td>
                  <td className="px-4 py-2 text-center">{u.last_report_edit || '-'}</td> {/* 显示最近日报编辑时间 */}
                  <td className="px-4 py-2 text-center">
                    {u.is_active ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs">活跃</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded bg-gray-200 text-gray-500 text-xs">未活跃</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {isAdminUser(u) ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-semibold">管理员</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">普通用户</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center whitespace-nowrap">
                    <button
                      disabled={isSelf(u.id)}
                      title={isSelf(u.id) ? '不能修改自己的角色' : '编辑用户角色'}
                      onClick={() => openRoleEditor(u)}
                      className="px-2 py-1 text-xs rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed mr-2"
                    >
                      编辑
                    </button>
                    <button
                      disabled={isSelf(u.id)}
                      title={isSelf(u.id) ? '不能删除自己' : '删除该用户及其全部数据'}
                      onClick={() => setDeleteTarget({ id: u.id, email: u.email })}
                      className="px-2 py-1 text-xs rounded border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 角色编辑框：下拉选择目标角色，与当前一致时禁用确认 */}
      <Dialog open={!!roleTarget} onOpenChange={(open) => { if (!open) setRoleTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑用户角色</DialogTitle>
            <DialogDescription>
              为 {roleTarget?.email} 选择角色，保存后实时生效。
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={roleEditValue} onValueChange={(v) => setRoleEditValue(v as 'user' | 'admin')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">普通用户</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
              </SelectContent>
            </Select>
            {roleUnchanged && (
              <p className="mt-2 text-xs text-gray-500">与当前角色一致，无需保存。</p>
            )}
          </div>
          <DialogFooter>
            <button
              onClick={() => setRoleTarget(null)}
              disabled={acting}
              className="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={confirmRoleChange}
              disabled={acting || roleUnchanged}
              title={roleUnchanged ? '角色未变化' : '保存角色'}
              className="px-4 py-2 text-sm rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {acting ? '保存中...' : '确认'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除用户确认框（危险操作） */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-700">确认删除用户？</DialogTitle>
            <DialogDescription>
              将永久删除 {deleteTarget?.email} 的账号及其<b>全部数据</b>（项目、日报、待办、工作分解、分享、AI 设置等），不可恢复，请慎重确认。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={acting}
              className="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={confirmDeleteUser}
              disabled={acting}
              className="px-4 py-2 text-sm rounded text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              {acting ? '删除中...' : '确认删除'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
