
import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { CaptchaInput, type CaptchaValue } from '../components/captcha-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaValue>({ token: '', code: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const signupAttemptRef = useRef<number>(0);
  const lastSignupTimeRef = useRef<number>(0);

  const validateForm = () => {
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return false;
    }
    if (password.length < 6) {
      setError('密码长度至少为6个字符');
      return false;
    }
    if (!captcha.code) {
      setError('请输入验证码');
      return false;
    }
    return true;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // 防止快速重复点击
    const now = Date.now();
    if (now - lastSignupTimeRef.current < 3000) {
      setError('请稍候再试');
      return;
    }

    // 检查注册尝试次数，实现指数退避
    const attemptCount = signupAttemptRef.current;
    if (attemptCount > 2) {
      const backoffTime = Math.min(Math.pow(2, attemptCount - 2) * 1000, 60000);
      if (now - lastSignupTimeRef.current < backoffTime) {
        setError(`请等待${Math.ceil(backoffTime / 1000)}秒后再试`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    lastSignupTimeRef.current = now;

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          captchaToken: captcha.token,
          captcha: captcha.code,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || '注册失败');
        signupAttemptRef.current++;
      } else {
        setSuccessMessage('注册成功，请登录您的账户');
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      }
    } catch {
      setError('注册时出错，请检查网络连接或稍后重试');
      signupAttemptRef.current++;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-primary">注册 DayCraft</CardTitle>
          <CardDescription>
            创建账号，开始您的日报管理之旅
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {successMessage ? (
            <div className="flex flex-col gap-6">
              <Alert>
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
              <div className="text-center">
                <Button variant="link" render={<Link to="/login" />}>
                  返回登录页面
                </Button>
              </div>
            </div>
          ) : (
            <form className="flex flex-col gap-6" onSubmit={handleSignup}>
              <Field>
                <FieldLabel htmlFor="name">姓名</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="请输入您的姓名"
                />
                <FieldError errors={[]} />
              </Field>

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
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码（至少6个字符）"
                />
                <FieldError errors={[]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="confirmPassword">确认密码</FieldLabel>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                />
                <FieldError errors={[]} />
              </Field>

              <CaptchaInput onChange={setCaptcha} />

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
                {loading ? "注册中..." : "注册"}
              </Button>
            </form>
          )}

          {!successMessage && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                已有账号? <Button variant="link" size="sm" render={<Link to="/login" />}>登录</Button>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
