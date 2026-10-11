/**
 * 分享 token 纯函数（从 lib/utils/share-cleanup.ts 复制，浏览器/Node 通用，无 supabase 依赖）。
 */

/** 检查分享是否有效（未过期且已启用） */
export function isShareValid(share: { is_active: boolean; expires_at: string | null }): boolean {
  if (!share.is_active) {
    return false;
  }

  if (share.expires_at) {
    const expiryDate = new Date(share.expires_at);
    const now = new Date();
    if (now > expiryDate) {
      return false;
    }
  }

  return true;
}

/** 生成安全的分享token（32 位十六进制） */
export function generateShareToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 验证分享token格式 */
export function isValidShareToken(token: string): boolean {
  // 检查是否为32位十六进制字符串
  return /^[a-f0-9]{32}$/i.test(token);
}
