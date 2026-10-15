// 查询参数助手：处理 string | string[] 两种取值形态（express query）。
// 调用方统一用 q(req, name)，不要在各路由里重复实现。
export function q(req: { query: unknown }, name: string): string | undefined {
  const query = req.query as Record<string, unknown>;
  const v = query[name];
  return Array.isArray(v) ? String(v[0]) : (v as string | undefined);
}
