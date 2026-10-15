
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { CaptchaInput, type CaptchaValue } from '../components/captcha-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

// 本地找回密码：凭 邮箱 + 验证码 直接设置新密码（不发送邮件）。
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaValue>({ token: '', code: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (newPassword.length < 6) {
      setError('密码长度至少为6个字符');
      return;
    }
    if (!captcha.code) {
      setError('请输入验证码');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          newPassword,
          captchaToken: captcha.token,
          captcha: captcha.code,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error || '重置密码失败');
      } else {
        setSuccessMessage(data.message || '密码重置成功，请使用新密码登录');
        setTimeout(() => navigate('/login'), 2000);
      }
    } catch (err) {
      setError('重置密码时出错，请重试');
      console.error('重置密码错误:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-primary">找回密码</CardTitle>
          <CardDescription>
            输入注册邮箱与验证码，直接设置新密码（无需邮件）
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
            <form className="flex flex-col gap-6" onSubmit={handleReset}>
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
                  placeholder="请输入您的注册邮箱"
                />
                <FieldError errors={[]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="newPassword">新密码</FieldLabel>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="请输入新密码（至少6个字符）"
                />
                <FieldError errors={[]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="confirmPassword">确认新密码</FieldLabel>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入新密码"
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
                {loading ? "提交中..." : "重置密码"}
              </Button>

              <div className="text-center text-sm">
                <Button variant="link" size="sm" render={<Link to="/login" />}>
                  返回登录页面
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
