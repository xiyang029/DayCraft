import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export type CaptchaValue = { token: string; code: string };

// 验证码字符的取色全部来自主题 token，避免硬编码色值。
const DIGIT_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-chart-4)'
];

// 4 位数字字母验证码输入框：验证码文本直接展示在页面上（不区分大小写），
// 点击可刷新。token 与用户输入通过 onChange 回传给父表单提交。
export function CaptchaInput({ onChange, refreshSignal }: { onChange: (v: CaptchaValue) => void; refreshSignal?: number }) {
  const [display, setDisplay] = useState('');
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchCaptcha = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ token: string; code: string }>('/api/auth/captcha');
      setToken(data.token);
      setDisplay(data.code);
      setInput('');
      onChange({ token: data.token, code: '' });
    } catch {
      setDisplay('????');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha]);

  // 父表单提交失败（如验证码错误）时递增 refreshSignal，自动拉取新验证码
  useEffect(() => {
    if (refreshSignal) fetchCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const handleInput = (v: string) => {
    setInput(v);
    onChange({ token, code: v });
  };

  return (
    <Field>
      <FieldLabel htmlFor="captcha">验证码</FieldLabel>
      <div className="flex gap-2">
        <Input
          id="captcha"
          type="text"
          autoComplete="off"
          required
          maxLength={4}
          value={input}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="不区分大小写"
        />
        <Button
          type="button"
          variant="outline"
          onClick={fetchCaptcha}
          disabled={loading}
          title="点击刷新验证码"
          className="shrink-0 select-none"
        >
          <span
            className="font-mono text-lg font-bold tracking-[0.3em] text-foreground"
            aria-label={`验证码 ${display}`}
          >
            {display.split('').map((ch, i) => (
              <span
                key={i}
                className="inline-block"
                style={{
                  transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (6 + i * 2)}deg)`,
                  color: DIGIT_COLORS[i % DIGIT_COLORS.length]
                }}
              >
                {ch}
              </span>
            ))}
          </span>
        </Button>
      </div>
      <FieldError errors={[]} />
    </Field>
  );
}
