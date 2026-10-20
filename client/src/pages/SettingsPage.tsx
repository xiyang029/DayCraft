import { useState, useEffect } from "react";
import { useAuth } from "../contexts/auth-context";
import { apiGet, apiPost, apiPut } from "../lib/api";
import type { UserAISettings } from "../lib/db/types";
import { toast } from "@/components/ui/toast";
import { Eye as EyeIcon, EyeOff as EyeOffIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldDescription, FieldError, FieldLegend, FieldSet, FieldLabel } from "@/components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function SettingsPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // 表单状态（模型名称为自由输入，不再提供预置枚举）
  const [settings, setSettings] = useState<UserAISettings | null>(null);
  const [formData, setFormData] = useState({
    api_url: "https://api.openai.com/v1",
    api_key: "",
    model_name: "",
    system_prompt: "你是一个专业的工作报告助手，负责帮助用户整理和生成日报、周报和月报。",
    user_prompt: "请根据我的工作内容，生成一份专业的{report_type}。以下是我的工作记录：\n\n{report_content}",
    is_enabled: true
  });

  // 加载用户AI设置
  useEffect(() => {
    async function loadSettings() {
      if (!user) return;

      try {
        const aiRes = await apiGet<{ settings: UserAISettings }>('/api/ai-settings');

        if (aiRes.settings) {
          const userSettings = aiRes.settings;
          setSettings(userSettings);

          setFormData({
            api_url: userSettings.api_url || "https://api.openai.com/v1",
            api_key: userSettings.api_key || "",
            model_name: userSettings.model_name || "",
            system_prompt: userSettings.system_prompt || "你是一个专业的工作报告助手，负责帮助用户整理和生成日报、周报和月报。",
            user_prompt: userSettings.user_prompt || "请根据我的工作内容，生成一份专业的{report_type}。以下是我的工作记录：\n\n{report_content}",
            is_enabled: userSettings.is_enabled !== undefined ? userSettings.is_enabled : true
          });
        }
      } catch (error) {
        console.error("加载设置时出错:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, [user]);

  // 处理表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSaving(true);

    try {
      // 模型名称为自由输入，保存前要求非空
      const modelNameToSave = formData.model_name.trim();
      if (!modelNameToSave) {
        toast.add({ title: "请填写模型名称", type: 'error' });
        setIsSaving(false);
        return;
      }

      // 服务端 upsert（不存在则自动创建）
      const res = await apiPut<{ settings: UserAISettings }>('/api/ai-settings', {
        api_url: formData.api_url,
        api_key: formData.api_key || settings?.api_key || null, // 如果未提供新API key，保留原有的
        model_name: modelNameToSave,
        system_prompt: formData.system_prompt,
        user_prompt: formData.user_prompt,
        is_enabled: formData.is_enabled
      });
      if (res.settings) setSettings(res.settings);

      toast.add({ title: "AI设置已保存", type: 'success' });
    } catch (error: any) {
      console.error("保存AI设置失败:", error);
      toast.add({ title: `保存失败: ${error.message || "未知错误"}`, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // 处理表单输入变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // 处理开关状态变化
  const handleSwitchChange = (checked: boolean) => {
    setFormData(prev => ({ ...prev, is_enabled: checked }));

    // 立即保存AI开关状态到数据库
    if (user && settings) {
      apiPut('/api/ai-settings', { is_enabled: checked })
        .then(() => {
          toast.add({ title: checked ? "AI功能已启用" : "AI功能已禁用", type: 'success' });
        })
        .catch((error: any) => {
          console.error("更新AI开关状态失败:", error);
          toast.add({ title: `更新失败: ${error.message || "未知错误"}`, type: 'error' });
          // 回滚状态
          setFormData(prev => ({ ...prev, is_enabled: !checked }));
        });
    }
  };

  // 测试API连接
  const testApiConnection = async () => {
    if (!formData.api_url || !formData.api_key) {
      toast.add({ title: "请先填写API URL和API Key", type: 'error' });
      return;
    }

    toast.add({ title: "正在测试API连接...", type: 'info' });

    try {
      // 通过代理路由测试API连接（绕过CORS）
      await apiPost<{ ok: boolean }>('/api/ai/test', {
        api_url: formData.api_url,
        api_key: formData.api_key,
      });
      toast.add({ title: "API连接测试成功", type: 'success' });
    } catch (error: unknown) {
      console.error("API连接测试失败:", error);
      toast.add({ title: `API连接测试失败: ${error instanceof Error ? error.message : "未知错误"}`, type: 'error' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">AI功能设置</CardTitle>
          <CardAction>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="ai-enabled" className={formData.is_enabled ? "text-primary" : "text-muted-foreground"}>
                {formData.is_enabled ? "已启用" : "已禁用"}
              </FieldLabel>
              <Switch
                id="ai-enabled"
                checked={formData.is_enabled}
                onCheckedChange={handleSwitchChange}
              />
              <FieldError errors={[]} />
            </Field>
          </CardAction>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <FieldSet className={!formData.is_enabled ? "opacity-50 pointer-events-none" : ""}>
              <FieldLegend>API设置</FieldLegend>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="api_url">API URL</FieldLabel>
                  <Input
                    id="api_url"
                    name="api_url"
                    type="text"
                    value={formData.api_url}
                    onChange={handleChange}
                    placeholder="https://api.openai.com/v1"
                    disabled={!formData.is_enabled}
                  />
                  <FieldError errors={[]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="api_key">API Key</FieldLabel>
                  <div className="relative">
                    <Input
                      id="api_key"
                      name="api_key"
                      type={showApiKey ? "text" : "password"}
                      value={formData.api_key}
                      onChange={handleChange}
                      placeholder={settings?.api_key ? "••••••••" : "sk-..."}
                      disabled={!formData.is_enabled}
                      className="pr-9"
                    />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            disabled={!formData.is_enabled}
                            aria-label={showApiKey ? '隐藏 Key' : '显示 Key'}
                            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "absolute inset-y-0 right-0")}
                          >
                            {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        }
                      />
                      <TooltipContent>{showApiKey ? '隐藏 Key' : '显示 Key'}</TooltipContent>
                    </Tooltip>
                  </div>
                  <FieldError errors={[]} />
                </Field>
              </div>
              <div className="flex">
                <Button
                  type="button"
                  onClick={testApiConnection}
                  disabled={!formData.is_enabled}
                >
                  测试API连接
                </Button>
              </div>
            </FieldSet>
            <FieldSet className={!formData.is_enabled ? "opacity-50 pointer-events-none" : ""}>
              <FieldLegend>模型设置</FieldLegend>
              <Field>
                <FieldLabel htmlFor="model_name">模型名称</FieldLabel>
                <Input
                  id="model_name"
                  name="model_name"
                  type="text"
                  value={formData.model_name}
                  onChange={handleChange}
                  placeholder="输入模型名称，例如：gpt-4o、deepseek-chat"
                  disabled={!formData.is_enabled}
                />
                <FieldDescription>
                  直接填写模型的准确标识符，需与 API 提供商的模型名称一致；API URL 请按提供商手动填写。
                </FieldDescription>
                <FieldError errors={[]} />
              </Field>
            </FieldSet>
            <FieldSet className={!formData.is_enabled ? "opacity-50 pointer-events-none" : ""}>
              <FieldLegend>提示词设置</FieldLegend>
              <Field>
                <FieldLabel htmlFor="system_prompt">系统提示词</FieldLabel>
                <Textarea
                  id="system_prompt"
                  name="system_prompt"
                  rows={3}
                  value={formData.system_prompt}
                  onChange={handleChange}
                  placeholder="你是一个专业的工作报告助手..."
                  disabled={!formData.is_enabled}
                />
                <FieldDescription>
                  系统提示词用于设置AI助手的角色和行为方式。
                </FieldDescription>
                <FieldError errors={[]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="user_prompt">用户提示词模板</FieldLabel>
                <Textarea
                  id="user_prompt"
                  name="user_prompt"
                  rows={5}
                  value={formData.user_prompt}
                  onChange={handleChange}
                  placeholder="请根据我的工作内容，生成一份专业的{report_type}..."
                  disabled={!formData.is_enabled}
                />
                <FieldDescription>
                  用户提示词模板用于生成报告时的指令。可以使用 {"{report_type}"} 和 {"{report_content}"} 作为占位符。
                </FieldDescription>
                <FieldError errors={[]} />
              </Field>
            </FieldSet>
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={isSaving || !formData.is_enabled}
              >
                {isSaving ? '保存中...' : '保存设置'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
