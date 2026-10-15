
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LocalUser, UserProfile } from '../lib/db/types';

interface AuthContextType {
  user: LocalUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshSession: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        setUser(null);
        setProfile(null);
        return null;
      }
      const data = (await res.json()) as { user: LocalUser; profile: UserProfile };
      setUser(data.user);
      setProfile(data.profile);
      return null;
    } catch (error) {
      console.error('刷新会话时出错:', error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // 页面重新可见时静默刷新会话（不触发页面重载）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshSession().catch((err) => console.error('静默刷新会话失败:', err));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshSession]);

  const signOut = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('退出登录时出错:', error);
    } finally {
      // 先跳转再清状态：否则 DashboardLayout 的登录守卫会先看到“dashboard 下无用户”，
      // 把本次跳转顶回 /login
      navigate('/');
      setUser(null);
      setProfile(null);
      setLoading(false);
    }
  };

  const value = { user, profile, loading, signOut, refreshSession };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
