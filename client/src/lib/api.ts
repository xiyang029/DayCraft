
// 统一的 JSON API 请求封装：自动拼装、解析错误并在 401 时跳登录页。

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    const p = window.location.pathname;
    if (!['/login', '/signup', '/forgot-password', '/reset-password'].includes(p)) {
      window.location.href = '/login';
    }
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 无 body（如 204）
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error || `请求失败（${res.status}）`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const apiGet = <T,>(path: string) => apiFetch<T>(path);

export function apiPost<T>(path: string, body: unknown) {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown) {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string) {
  return apiFetch<T>(path, { method: 'DELETE' });
}
