import { apiGet } from '@/lib/api';

/** 团队报告（管理员视图）数据访问层，对应 server/src/routes/admin-reports.ts */

export interface TeamMemberNode {
  id: string;
  name: string;
  email: string;
  role: string[];
  last_report_edit_at: string | null;
  daily_count: number;
  item_count: number;
  weekly_count: number;
  monthly_count: number;
  last_date: string | null;
}

export interface TeamProjectNode {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  owner_name: string;
  item_count: number;
  member_count: number;
  last_date: string | null;
}

export interface TeamLink {
  user_id: string;
  project_id: string;
  item_count: number;
  last_date: string;
}

export interface TeamGraph {
  members: TeamMemberNode[];
  projects: TeamProjectNode[];
  links: TeamLink[];
  totals: { members: number; projects: number; daily_reports: number; items: number };
}

export interface TeamReportItem {
  id: string;
  project_id: string | null;
  content: string;
  projects: { id: string; name: string | null; code: string | null } | null;
}

export interface TeamDailyReport {
  id: string;
  user_name: string;
  date: string;
  items: TeamReportItem[];
}

export interface TeamWeeklyReport {
  id: string;
  user_name: string;
  year: number;
  week_number?: number;
  month?: number;
  start_date: string;
  end_date: string;
  content?: string;
  status?: string;
  items?: TeamReportItem[];
}

export type WeeklyKind = 'weekly' | 'monthly';

const qs = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
};

export function fetchTeamGraph(start: string, end: string) {
  return apiGet<TeamGraph>(`/api/admin/reports/graph${qs({ start, end })}`);
}

export function fetchTeamDaily(params: {
  start: string;
  end: string;
  user_id?: string;
  project_id?: string;
  limit?: number;
}) {
  return apiGet<{ range: { start: string; end: string }; reports: TeamDailyReport[]; total: number }>(
    `/api/admin/reports/daily${qs({ ...params, with_items: 1 })}`,
  );
}

export function fetchTeamWeekly(params: {
  kind: WeeklyKind;
  start: string;
  end: string;
  user_id?: string;
  limit?: number;
}) {
  return apiGet<{ kind: WeeklyKind; range: { start: string; end: string }; reports: TeamWeeklyReport[]; total: number }>(
    `/api/admin/reports/weekly${qs(params)}`,
  );
}
