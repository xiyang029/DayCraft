import { Router } from 'express';
import { requireUser } from '../lib/session';

// AI 代理：OpenAI 兼容接口转发。前端直连第三方会被 CORS 拦截且 key 暴露，
// 因此经服务端转发（key 仍由用户在设置页自填自管，服务端不落库、不记日志）。
// 注意：仅支持 OpenAI 兼容的 /chat/completions 与 /models（如 OpenAI / DeepSeek / 自建兼容网关）。
export const aiRouter = Router();

function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

// POST /api/ai —— 润色：透传上游 chat completions 结果，前端读 choices[0].message.content
aiRouter.post('/', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const body = req.body as {
      api_url?: unknown;
      api_key?: unknown;
      model?: unknown;
      messages?: unknown;
      temperature?: unknown;
    };
    const baseUrl = normalizeBaseUrl(body.api_url);
    if (!baseUrl) return res.status(400).json({ error: { message: 'API URL 非法（仅支持 http/https）' } });
    if (typeof body.api_key !== 'string' || !body.api_key) {
      return res.status(400).json({ error: { message: '缺少 API Key，请先在设置页面配置' } });
    }
    if (typeof body.model !== 'string' || !body.model) {
      return res.status(400).json({ error: { message: '缺少模型名称' } });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({ error: { message: '缺少 messages' } });
    }
    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${body.api_key}`,
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      console.error('AI 代理请求失败:', error);
      return res.status(502).json({ error: { message: '无法连接 AI 服务，请检查 API URL 与网络' } });
    }
    const data = (await upstream.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!upstream.ok) {
      // 上游状态码不得原样透传：上游 401（如 Key 无效）若透传给前端，
      // 会触发客户端“会话过期跳登录”全局逻辑导致页面被踢走（血案）。
      // 连通性/润色失败一律归一为 502 + 保留上游信息。
      const message = data?.error?.message || `AI 服务返回错误状态码: ${upstream.status}`;
      return res.status(502).json({ error: { message } });
    }
    return res.json(data);
  } catch (error) {
    console.error('AI 润色失败:', error);
    return res.status(500).json({ error: { message: '服务器内部错误' } });
  }
});

// POST /api/ai/test —— 连通性测试：调上游 /models，通即成功（前端只看 response.ok）
aiRouter.post('/test', async (req, res) => {
  try {
    const checked = await requireUser(req);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const body = req.body as { api_url?: unknown; api_key?: unknown };
    const baseUrl = normalizeBaseUrl(body.api_url);
    if (!baseUrl) return res.status(400).json({ error: 'API URL 非法（仅支持 http/https）' });
    if (typeof body.api_key !== 'string' || !body.api_key) {
      return res.status(400).json({ error: '缺少 API Key' });
    }
    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${body.api_key}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      console.error('AI 连通性测试失败:', error);
      return res.status(502).json({ error: '无法连接 AI 服务，请检查 API URL 与网络' });
    }
    if (!upstream.ok) {
      // 同上：上游 401（常见于 Key 无效）不得透传，否则前端误判会话过期跳登录页。
      return res.status(502).json({ error: `API 返回错误状态码: ${upstream.status}` });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('AI 连通性测试失败:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});
