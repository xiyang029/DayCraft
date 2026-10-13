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

export type DailyReport = {
  id: string;
  user_id: string;
  date: string;
  created_at: string;
  updated_at: string;
  is_plan?: boolean;
};

export type ReportItem = {
  id: string;
  report_id: string;
  project_id: string;
  content: string;
  created_at: string;
};

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string[];
  created_at?: string;
  updated_at?: string;
  last_sign_in_at?: string | null;
  last_report_edit_at?: string | null;
};

export type WeeklyReport = {
  id: string;
  user_id: string;
  year: number;
  week_number: number;
  start_date: string;
  end_date: string;
  content: string;
  status: 'generated' | 'draft';
  created_at: string;
  updated_at: string;
};

export type MonthlyReport = {
  id: string;
  user_id: string;
  year: number;
  month: number;
  start_date: string;
  end_date: string;
  content: string;
  status: 'generated' | 'draft';
  created_at: string;
  updated_at: string;
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
  planned_start_time: string | null;
  planned_end_time: string | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  is_milestone: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type ProjectWeeklyReport = {
  id: string;
  user_id: string;
  year: number;
  week_number: number;
  start_date: string;
  end_date: string;
  is_plan: boolean;
  created_at: string;
  updated_at: string;
};

export type ProjectWeeklyReportItem = {
  id: string;
  report_id: string;
  project_id: string | null;
  work_item_id: string | null;
  content: string;
  project_name: string | null;
  project_code: string | null;
  work_item_name: string | null;
  work_item_path: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectTodo = {
  id: string;
  user_id: string;
  project_id: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
  due_date: string;
  status: 'not_started' | 'in_progress' | 'completed';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkBreakdownShare = {
  id: string;
  project_id: string | null;
  user_id: string;
  share_token: string;
  has_password: boolean;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  projects?: Array<{ id: string; name: string; code: string }>;
};
