
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LocalUser, UserProfile } from '../lib/db/types';

interface AuthContextType {
  user: LocalUser | null;
  profile: UserProfile | null;
  session: null;
  loading: boolean;
  isInitialized: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  isInitialized: false,
  signOut: async () => {},
  refreshSession: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
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
      setIsInitialized(true);
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
      setUser(null);
      setProfile(null);
    } catch (error) {
      console.error('退出登录时出错:', error);
    } finally {
      setLoading(false);
      navigate('/login');
    }
  };

  const value = { user, profile, session: null, loading, isInitialized, signOut, refreshSession };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
