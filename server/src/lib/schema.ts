// SQLite 初始化建表语句（由原 sql/create_tables.sql 的 Postgres 版本移植）。
// 差异说明：
// - 无 auth.users，改为本地 users 表；外键仅作声明，不强制跨表级联（除必要的 ON DELETE CASCADE）
// - UUID 全部为 TEXT，由业务代码 crypto.randomUUID() 生成
// - BOOLEAN 全部为 INTEGER（0/1），API 层与前端做 boolean 映射
// - role TEXT[] 改为 TEXT（JSON 数组字符串，如 '["user"]'）
// - RLS 策略 / 触发器 / JWT hook 不再需要，由 API 层的会话校验替代

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT '["user"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_report_edit_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (code, user_id)
);
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);

CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS daily_reports_user_id_idx ON daily_reports(user_id);

CREATE TABLE IF NOT EXISTS report_items (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS report_items_report_id_idx ON report_items(report_id);
CREATE INDEX IF NOT EXISTS report_items_project_id_idx ON report_items(project_id);

CREATE TABLE IF NOT EXISTS work_breakdown_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  parent_id TEXT REFERENCES work_breakdown_items(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  is_expanded INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT '未开始',
  tags TEXT,
  members TEXT,
  progress_notes TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_breakdown_items_project_id_idx ON work_breakdown_items(project_id);
CREATE INDEX IF NOT EXISTS work_breakdown_items_parent_id_idx ON work_breakdown_items(parent_id);
CREATE INDEX IF NOT EXISTS work_breakdown_items_user_id_idx ON work_breakdown_items(user_id);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  week_number INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, year, week_number)
);
CREATE INDEX IF NOT EXISTS weekly_reports_user_id_idx ON weekly_reports(user_id);

CREATE TABLE IF NOT EXISTS monthly_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, year, month)
);
CREATE INDEX IF NOT EXISTS monthly_reports_user_id_idx ON monthly_reports(user_id);

CREATE TABLE IF NOT EXISTS user_ai_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  api_url TEXT NOT NULL DEFAULT 'https://api.deepseek.com/v1',
  api_key TEXT,
  model_name TEXT NOT NULL DEFAULT 'deepseek-chat',
  system_prompt TEXT NOT NULL DEFAULT '你是一个智能助手，可以帮助用户生成日报、周报和月报。请根据用户提供的信息，生成专业、简洁的报告内容。',
  user_prompt TEXT NOT NULL DEFAULT '请根据我的工作内容，生成一份专业的日报。',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 验证码（SQLite 持久化：Next 各路由可能独立打包，内存 Map 无法跨路由共享）
CREATE TABLE IF NOT EXISTS captchas (
  token TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS captchas_expires_at_idx ON captchas(expires_at);
`;
