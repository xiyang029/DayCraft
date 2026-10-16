
import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { CaptchaInput, type CaptchaValue } from '../components/captcha-input';
import { useAuth } from '../contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel, FieldSeparator } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaValue>({ token: '', code: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 提交失败时递增，驱动验证码自动刷新（服务端验证码一次性核销，失败后旧码不可复用）
  const [captchaRefresh, setCaptchaRefresh] = useState(0);
  const navigate = useNavigate();
  const { refreshSession } = useAuth();
  const loginAttemptRef = useRef<number>(0);
  const lastLoginTimeRef = useRef<number>(0);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 验证输入
    if (!email || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    if (!captcha.code) {
      setError('请输入验证码');
      return;
    }

    // 防止快速重复点击
    const now = Date.now();
    if (now - lastLoginTimeRef.current < 2000) {
      setError('请稍候再试');
      return;
    }

    // 检查登录尝试次数，实现指数退避
    const attemptCount = loginAttemptRef.current;
    if (attemptCount > 3) {
      const backoffTime = Math.min(Math.pow(2, attemptCount - 3) * 1000, 30000);
      if (now - lastLoginTimeRef.current < backoffTime) {
        setError(`请等待${Math.ceil(backoffTime / 1000)}秒后再试`);
        return;
      }
    }

    setLoading(true);
    lastLoginTimeRef.current = now;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          captchaToken: captcha.token,
          captcha: captcha.code,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || '登录失败');
        loginAttemptRef.current++;
        setCaptchaRefresh((n) => n + 1);
      } else {
        loginAttemptRef.current = 0;
        // 先把服务端刚种下的会话 Cookie 同步到 AuthProvider，
        // 否则 RequireAuth 守卫看到 user 为空会立刻踢回 /login
        await refreshSession();
        navigate('/dashboard/overview');
      }
    } catch {
      setError('登录时出错，请检查网络连接或稍后重试');
      loginAttemptRef.current++;
      setCaptchaRefresh((n) => n + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-primary">登录 DayCraft</CardTitle>
          <CardDescription>
            记录每日工作，高效生成周报月报
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form className="flex flex-col gap-6" onSubmit={handleLogin}>
            <Field>
              <FieldLabel htmlFor="email">邮箱地址</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入您的邮箱"
              />
              <FieldError errors={[]} />
            </Field>

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Button variant="link" size="sm" nativeButton={false} render={<Link to="/forgot-password" />}>
                  忘记密码?
                </Button>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入您的密码"
              />
              <FieldError errors={[]} />
            </Field>

            <CaptchaInput onChange={setCaptcha} refreshSignal={captchaRefresh} />

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading && <Spinner data-icon="inline-start" />}
              {loading ? "登录中..." : "登录"}
            </Button>
          </form>

          <FieldSeparator>没有账号?</FieldSeparator>

          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link to="/signup" />}
          >
            注册新账号
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
