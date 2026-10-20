// 全局共享的业务类型（SQLite 本地版本）

export type LocalUser = {
  id: string;
  email: string;
};

export type Project = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
};

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: string[];
  created_at?: string;
  updated_at?: string;
  last_report_edit_at?: string | null;
};

export type UserAISettings = {
  id: string;
  user_id: string;
  api_url: string;
  api_key: string | null;
  model_name: string;
  system_prompt: string;
  user_prompt: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkBreakdownItem = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  level: number;
  position: number;
  is_expanded: boolean;
  status: string;
  tags: string | null;
  members: string | null;
  progress_notes: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
};

