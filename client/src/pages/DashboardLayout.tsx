
import { useState, useEffect } from "react";
import { Link, Outlet } from 'react-router-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FileTextIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  FolderIcon,
  Settings2Icon,
  ShieldCheckIcon,
  Radar as RadarIcon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from "lucide-react";
import { cn } from "cn";
import { useAuth } from "../contexts/auth-context";
import type { UserProfile as DBUserProfile } from "../lib/db/types";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface UserProfile {
  name: string;
  email: string;
  role: string[];
}

// 动态导航项配置
const getNavigation = (role: string[] = []) => {
  const isAdmin = role.includes('admin');
  const isUser = role.includes('user');
  // 仅 admin 且不是双重角色时，只显示管理员菜单
  if (isAdmin && !isUser && role.length === 1) {
    return [
      { name: "团队报告", href: "/dashboard/team-reports", icon: RadarIcon, subItems: undefined },
      { name: "系统管理", href: "/dashboard/admin", icon: ShieldCheckIcon, subItems: undefined }
    ];
  }
  // 仅 user 时，只显示普通菜单
  if (isUser && !isAdmin && role.length === 1) {
    return [
      { name: "概览", href: "/dashboard/overview", icon: LayoutDashboardIcon },
      {
        name: "项目",
        href: "/dashboard/projects", // 修改为项目管理页面链接
        icon: FolderIcon,
        subItems: [
          { name: "项目管理", href: "/dashboard/projects" },
          { name: "工作分解", href: "/dashboard/work-breakdown" }
        ]
      },
      {
        name: "报告",
        href: "/dashboard/daily-reports", // 修改为实际链接而不是"#"
        icon: FileTextIcon,
        subItems: [
          { name: "日报", href: "/dashboard/daily-reports" },
          { name: "周报/月报", href: "/dashboard/reports" }
        ]
      },
      { name: "设置", href: "/dashboard/settings", icon: Settings2Icon },
    ];
  }
  // 同时有 admin 和 user 时，显示普通菜单+系统管理
  if (isAdmin && isUser) {
    return [
      { name: "概览", href: "/dashboard/overview", icon: LayoutDashboardIcon },
      {
        name: "项目",
        href: "/dashboard/projects", // 修改为实际链接而不是"#"
        icon: FolderIcon,
        subItems: [
          { name: "项目管理", href: "/dashboard/projects" },
          { name: "工作分解", href: "/dashboard/work-breakdown" }
        ]
      },
      {
        name: "报告",
        href: "/dashboard/daily-reports", // 修改为实际链接而不是"#"
        icon: FileTextIcon,
        subItems: [
          { name: "日报", href: "/dashboard/daily-reports" },
          { name: "周报/月报", href: "/dashboard/reports" },
          { name: "团队报告", href: "/dashboard/team-reports" }
        ]
      },
      { name: "设置", href: "/dashboard/settings", icon: Settings2Icon },
      { name: "系统管理", href: "/dashboard/admin", icon: ShieldCheckIcon, subItems: undefined },
    ];
  }
  // 其他情况（无角色或未知角色）
  return [];
};

export default function DashboardLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // 默认在移动端关闭侧边栏
  const [sidebarExpanded, setSidebarExpanded] = useState(true); // 控制侧边栏展开/折叠
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const { user, signOut, loading: authLoading } = useAuth();

  // 添加一个标记，避免重复获取用户资料
  const [profileFetched, setProfileFetched] = useState(false);

  // 从 localStorage 加载侧边栏状态
  useEffect(() => {
    setIsMounted(true);
    const savedExpanded = localStorage.getItem("sidebarExpanded");
    if (savedExpanded !== null) {
      setSidebarExpanded(savedExpanded === "true");
    }
  }, []);

  // 仪表盘是全屏固定布局：锁住 body 滚动，避免出现「窗口滚动条 + 内容滚动条」双滚动条
  // （100vh 不扣除横向滚动条，边界情况下文档会溢出视口，底部还会露出一条空白）
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // 根据屏幕大小设置侧边栏默认状态
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) { // md 断点
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };

    // 初始化时执行一次
    handleResize();

    // 监听窗口大小变化
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 在路由变化时关闭移动端侧边栏
  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    // 只有在认证状态确定后再检查用户是否已登录
    if (!authLoading) {
      if (!user) {
        console.log('未检测到已登录用户，重定向到登录页');
        navigate('/login', { replace: true });
        return;
      }

      // 用户已登录，且用户资料未获取过，则获取用户资料
      if (!profileFetched && !userProfile) {
        fetchUserProfile();
      } else if (userProfile) {
        // 如果已有用户资料，直接结束加载状态
        setIsLoading(false);
      }
    }
  }, [user, authLoading, profileFetched, userProfile]);

  // 获取用户资料信息（本地 API）
  const fetchUserProfile = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) throw new Error('获取用户资料失败');
      const data = (await res.json()) as { profile: DBUserProfile };
      const p = data.profile;
      const profile = {
        name: p.full_name || user.email?.split('@')[0] || '用户',
        email: p.email || user.email || '',
        role: Array.isArray(p.role) ? p.role : ['user'],
      };
      setUserProfile(profile);
      console.log('当前用户角色:', profile.role);
      setProfileFetched(true);
    } catch (error) {
      console.error('处理用户资料时出错:', error);
      if (user) {
        const basicProfile = {
          name: user.email?.split('@')[0] || '用户',
          email: user.email || '',
          role: ['user']
        };
        setUserProfile(basicProfile);
        console.log('当前用户角色:', basicProfile.role);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // 切换侧边栏展开/折叠状态
  const toggleSidebarExpand = () => {
    const newState = !sidebarExpanded;
    setSidebarExpanded(newState);
    if (isMounted) {
      localStorage.setItem("sidebarExpanded", String(newState));
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  // 在组件内，动态获取导航项
  const navigation = getNavigation(userProfile?.role);

  // 处理加载状态
  if (isLoading || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-muted">
      {/* 移动端侧边栏切换按钮 - 固定在右下角 */}
      <Button
        onClick={toggleSidebar}
        size="icon-lg"
        className="fixed right-4 bottom-4 z-50 rounded-full shadow-lg md:hidden"
        aria-label={isSidebarOpen ? "关闭菜单" : "打开菜单"}
      >
        {isSidebarOpen ? <XIcon /> : <MenuIcon />}
      </Button>

      {/* 侧边栏 - 移动端使用绝对定位覆盖 */}
      <div
        className={cn(
          "transform fixed inset-y-0 left-0 z-40 overflow-hidden border-r border-border bg-card transition-all duration-300 ease-in-out md:relative md:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          sidebarExpanded ? "w-64" : "w-16"
        )}
      >
        <div className="flex h-full flex-col">
          {/* 侧边栏头部 */}
          <div className={cn("flex items-center px-4 py-5", sidebarExpanded ? "justify-between" : "justify-center")}>
            {sidebarExpanded && (
              <div className="text-xl font-semibold whitespace-nowrap text-foreground">
                DayCraft
              </div>
            )}
            {/* PC端折叠/展开按钮 */}
            <Button
              onClick={toggleSidebarExpand}
              variant="ghost"
              size="icon"
              aria-label={sidebarExpanded ? "折叠侧边栏" : "展开侧边栏"}
              title={sidebarExpanded ? "折叠侧边栏" : "展开侧边栏"}
            >
              {sidebarExpanded ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </Button>
            {/* 移动端关闭按钮 */}
            {sidebarExpanded && (
              <Button
                onClick={toggleSidebar}
                variant="ghost"
                size="icon-sm"
                className="ml-1 md:hidden"
                aria-label="关闭菜单"
              >
                <XIcon />
              </Button>
            )}
          </div>

          {/* 导航菜单 */}
          <nav className="px-2 py-4">
            <ul className="flex flex-col gap-1">
              {navigation.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.subItems?.some((sub) => pathname === sub.href) ?? false);
                return (
                  <li key={item.href}>
                    {/* 折叠态以 Tooltip 代替 title；TooltipTrigger 的目标只能是原生元素，故用 span 承载 */}
                    <Tooltip>
                      <TooltipTrigger
                        disabled={sidebarExpanded}
                        render={<span className="block w-full" />}
                      >
                        <Button
                          variant="ghost"
                          nativeButton={false}
                          title={!sidebarExpanded ? item.name : ""}
                          className={cn(
                            "w-full",
                            sidebarExpanded ? "justify-start" : "justify-center",
                            isActive
                              ? "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                          render={
                            <Link
                              to={item.href}
                              aria-label={item.name}
                              onClick={() => {
                                if (window.innerWidth < 768) {
                                  setIsSidebarOpen(false);
                                }
                                // 如果有子项，不阻止默认行为，让链接正常跳转
                              }}
                            />
                          }
                        >
                          <item.icon className="size-5 shrink-0" />
                          <span
                            className={cn(
                              "whitespace-nowrap transition-all duration-300",
                              sidebarExpanded ? "opacity-100" : "w-0 overflow-hidden opacity-0"
                            )}
                          >
                            {item.name}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">{item.name}</TooltipContent>
                    </Tooltip>
                    {sidebarExpanded && item.subItems && item.subItems.length > 0 && (
                      <ul className="mt-1 ml-6 flex flex-col gap-1">
                        {item.subItems.map((subItem) => (
                          <li key={subItem.href}>
                            <Button
                              variant="ghost"
                              nativeButton={false}
                              className={cn(
                                "w-full justify-start",
                                pathname === subItem.href
                                  ? "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                              )}
                              render={
                                <Link
                                  to={subItem.href}
                                  onClick={(e) => {
                                    if (window.innerWidth < 768) {
                                      setIsSidebarOpen(false);
                                    }
                                    // 阻止事件冒泡，避免触发父菜单项的点击处理程序
                                    e.stopPropagation();
                                  }}
                                />
                              }
                            >
                              <span>{subItem.name}</span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* 侧边栏底部 */}
          <div className="mt-auto flex flex-col gap-3 p-4">
            <Separator />
            {sidebarExpanded && (
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>
                    {userProfile && userProfile.name ? userProfile.name.charAt(0).toUpperCase() : "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{userProfile?.name || "用户"}</p>
                  <p className="max-w-37.5 truncate text-xs text-muted-foreground">{userProfile?.email || ""}</p>
                </div>
              </div>
            )}
            <Button
              onClick={handleSignOut}
              variant="ghost"
              className={cn("w-full", sidebarExpanded ? "justify-start" : "justify-center")}
              title={!sidebarExpanded ? "退出登录" : ""}
            >
              <LogOutIcon data-icon="inline-start" />
              <span
                className={cn(
                  "whitespace-nowrap transition-all duration-300",
                  sidebarExpanded ? "opacity-100" : "w-0 overflow-hidden opacity-0"
                )}
              >
                退出登录
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex w-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶部导航栏 */}
        <header className="border-b border-border bg-card">
          <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
              {/* 移动端显示菜单按钮 */}
              <Button
                onClick={toggleSidebar}
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="打开菜单"
              >
                <MenuIcon />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground sm:inline-block">
                {userProfile?.name || "用户"}
              </span>
              {/* 角色标签：只显示最高权限（admin 优先），避免双 badge */}
              {(() => {
                const roles = userProfile?.role ?? [];
                if (roles.includes('admin')) {
                  return (
                    <Badge>
                      管理员
                    </Badge>
                  );
                }
                if (roles.includes('user')) {
                  return (
                    <Badge variant="secondary">
                      普通用户
                    </Badge>
                  );
                }
                return (
                  <Badge variant="outline">无角色</Badge>
                );
              })()}
              {/* 移动端显示用户头像 */}
              <Avatar className="sm:hidden">
                <AvatarFallback>
                  {userProfile && userProfile.name ? userProfile.name.charAt(0).toUpperCase() : "U"}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* 页面内容 - 调整内边距以适应移动端 */}
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-muted p-3 sm:p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      {/* 移动端侧边栏背景遮罩 */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/20 md:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        ></div>
      )}
    </div>
  );
}
