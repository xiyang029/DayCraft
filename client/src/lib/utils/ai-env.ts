// 系统内置AI配置读取工具
export function getSystemAIConfig() {
  return {
    api_url: import.meta.env.VITE_AI_API_URL || '',
    api_key: import.meta.env.VITE_AI_API_KEY || '',
    model_name: import.meta.env.VITE_AI_MODEL_NAME || '',
    system_prompt: import.meta.env.VITE_AI_SYSTEM_PROMPT || '',
    user_prompt: import.meta.env.VITE_AI_USER_PROMPT || '',
  };
}
