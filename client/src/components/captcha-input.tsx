
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

export type CaptchaValue = { token: string; code: string };

// 4 位数字字母验证码输入框：验证码文本直接展示在页面上（不区分大小写），
// 点击可刷新。token 与用户输入通过 onChange 回传给父表单提交。
export function CaptchaInput({ onChange }: { onChange: (v: CaptchaValue) => void }) {
  const [display, setDisplay] = useState('');
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchCaptcha = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/captcha');
      const data = (await res.json()) as { token: string; code: string };
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

  const handleInput = (v: string) => {
    setInput(v);
    onChange({ token, code: v });
  };

  return (
    <div>
      <label htmlFor="captcha" className="block text-sm font-medium text-gray-700">
        验证码
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="captcha"
          type="text"
          autoComplete="off"
          required
          maxLength={4}
          value={input}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="不区分大小写"
          className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
        <button
          type="button"
          onClick={fetchCaptcha}
          disabled={loading}
          title="点击刷新验证码"
          className="shrink-0 flex items-center gap-1 px-3 rounded-md bg-slate-100 border border-gray-300 select-none"
        >
          <span className="font-mono text-lg font-bold tracking-[0.3em] text-slate-800" aria-label={`验证码 ${display}`}>
            {display.split('').map((ch, i) => (
              <span
                key={i}
                className="inline-block"
                style={{
                  transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (6 + i * 2)}deg)`,
                  color: ['#1d4ed8', '#047857', '#b45309', '#7c3aed'][i % 4],
                }}
              >
                {ch}
              </span>
            ))}
          </span>
        </button>
      </div>
    </div>
  );
}
