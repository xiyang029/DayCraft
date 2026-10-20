/**
 * 演示数据填充脚本（工作分解 3D 世界 + 团队报告星图）。
 *
 * 用法（仓库根目录）：
 *   node scripts/seed-mock.mjs
 *
 * 特点：
 * - 只增删 id / 邮箱带 mock 标记的数据，不碰真实项目与日报；
 * - 可重复执行：每次先删掉上一批 mock 数据再按今天重新生成；
 * - 管理员账号（role 含 admin）会自动拥有 5 个带完整 WBS 树的项目；
 * - 另外生成 14 个 mock 成员、23 个团队项目、近 30 天日报/周报/月报。
 *
 * mock 成员统一密码：Mock@123456
 */
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(path.join(root, 'server', 'package.json'));
const bcrypt = requireFromServer('bcryptjs');

const dbPath = process.env.SQLITE_DB_PATH || path.join(root, 'data', 'daycraft.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const toDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const atTime = (d, h, m = 0) => {
  const copy = new Date(d);
  copy.setHours(h, m, 0, 0);
  return copy.toISOString();
};
const addDays = (d, days) => new Date(d.getTime() + days * 86400000);
const pick = (list, seed) => list[Math.abs(seed) % list.length];

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function weekBounds(date) {
  const d = new Date(date);
  const offset = (d.getDay() + 6) % 7;
  const start = addDays(d, -offset);
  const end = addDays(start, 6);
  return { start: toDate(start), end: toDate(end) };
}

function monthBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: toDate(start), end: toDate(end) };
}

const admin = db
  .prepare(
    `SELECT u.id, u.email FROM users u
     JOIN user_profiles p ON p.id = u.id
     WHERE p.role LIKE '%admin%'
     ORDER BY u.created_at ASC LIMIT 1`,
  )
  .get();

if (!admin) {
  console.error('未找到管理员账号，请先在页面上注册首个用户。');
  process.exit(1);
}

const MEMBERS = [
  ['陈晓雯', 'chen.xiaowen'],
  ['李哲宇', 'li.zheyu'],
  ['王若涵', 'wang.ruohan'],
  ['张铭轩', 'zhang.mingxuan'],
  ['赵雨桐', 'zhao.yutong'],
  ['周子墨', 'zhou.zimo'],
  ['孙嘉怡', 'sun.jiayi'],
  ['吴承霖', 'wu.chenglin'],
  ['郑一诺', 'zheng.yinuo'],
  ['何思远', 'he.siyuan'],
  ['林诗语', 'lin.shiyu'],
  ['黄浩然', 'huang.haoran'],
  ['徐安琪', 'xu.anqi'],
  ['马俊杰', 'ma.junjie'],
];

const TEAM_PROJECTS = [
  ['智能协作平台', 'MOCK-T01'],
  ['客户数据中台', 'MOCK-T02'],
  ['移动端体验升级', 'MOCK-T03'],
  ['营销自动化引擎', 'MOCK-T04'],
  ['供应链可视化', 'MOCK-T05'],
  ['财务共享中心', 'MOCK-T06'],
  ['知识库问答助手', 'MOCK-T07'],
  ['统一身份认证', 'MOCK-T08'],
  ['质量监控看板', 'MOCK-T09'],
  ['低代码表单引擎', 'MOCK-T10'],
  ['实时消息网关', 'MOCK-T11'],
  ['数据资产目录', 'MOCK-T12'],
  ['智能客服机器人', 'MOCK-T13'],
  ['研发效能平台', 'MOCK-T14'],
  ['多云资源调度', 'MOCK-T15'],
  ['合同电子签', 'MOCK-T16'],
  ['门店运营系统', 'MOCK-T17'],
  ['培训学习中心', 'MOCK-T18'],
  ['风控规则引擎', 'MOCK-T19'],
  ['用户增长实验台', 'MOCK-T20'],
  ['运维告警中心', 'MOCK-T21'],
  ['文档协同空间', 'MOCK-T22'],
  ['经营分析驾驶舱', 'MOCK-T23'],
];

const WB_PROJECTS = [
  ['星环智能协作平台', 'MOCK-W01', '面向多团队的智能协作与工作分解平台'],
  ['企业数据中台重构', 'MOCK-W02', '统一指标口径与实时数据服务的重构项目'],
  ['移动端体验升级', 'MOCK-W03', 'App 核心链路体验与性能专项治理'],
  ['研发效能提升计划', 'MOCK-W04', 'CI/CD、质量门禁与研发度量体系建设'],
  ['客户成功运营系统', 'MOCK-W05', '客户全生命周期运营与续约预警平台'],
];

const TREE_TEMPLATE = [
  {
    name: '需求与方案',
    tags: '需求，方案',
    description: '澄清业务目标，完成需求拆解与总体方案设计',
    children: [
      ['用户调研与画像', 3],
      ['业务流程梳理', 3],
      ['需求规格说明', 2],
    ],
  },
  {
    name: '体验与视觉设计',
    tags: '设计，体验',
    description: '完成信息架构、交互原型与视觉规范',
    children: [
      ['信息架构设计', 3],
      ['交互原型走查', 3],
      ['视觉规范落地', 2],
    ],
  },
  {
    name: '前端研发',
    tags: '前端，研发',
    description: '核心页面、组件库与前端性能建设',
    children: [
      ['组件库搭建', 3],
      ['核心页面开发', 3],
      ['状态与数据流', 2],
    ],
  },
  {
    name: '服务端研发',
    tags: '后端，研发',
    description: '接口、数据模型、权限与异步任务',
    children: [
      ['接口设计与实现', 3],
      ['数据模型与迁移', 3],
      ['权限与审计', 2],
    ],
  },
  {
    name: '测试与质量',
    tags: '测试，质量',
    description: '测试计划、自动化与性能压测',
    children: [
      ['测试用例设计', 3],
      ['自动化回归', 3],
      ['性能与稳定性', 2],
    ],
  },
  {
    name: '发布与运营',
    tags: '发布，运营',
    description: '灰度发布、监控告警与上线复盘',
    children: [
      ['灰度发布方案', 3],
      ['监控与告警', 3],
      ['数据看板与复盘', 2],
    ],
  },
];

const TASK_SUFFIXES = ['拆解与排期', '执行与联调', '验收与归档'];
const STATUSES = ['已完成', '进行中', '进行中', '已完成', '未开始', '已暂停'];
const NOTES = [
  '已完成评审，待补充边界场景用例。',
  '联调中发现接口字段不一致，已同步后端修正。',
  '当前进度正常，风险点已记录在周报中。',
  '依赖上游数据延迟，预计顺延 2 天。',
  '完成首轮自测，等待测试环境回归。',
];
const DAILY_CONTENTS = [
  '完成核心接口联调，修复 3 个边界问题',
  '推进页面开发与交互走查，补齐空状态',
  '优化查询链路，接口平均耗时下降 18%',
  '补充自动化用例，覆盖主要业务分支',
  '梳理数据口径并与业务方完成确认',
  '处理线上反馈，完成热修复与回归验证',
  '整理技术方案文档，输出评审结论',
  '完成权限矩阵调整与审计日志校验',
];

db.exec('BEGIN');
try {
  // 清理上一批 mock 数据（按外键依赖顺序）
  db.exec("DELETE FROM report_items WHERE id LIKE 'mock-%'");
  db.exec("DELETE FROM daily_reports WHERE id LIKE 'mock-%'");
  db.exec("DELETE FROM weekly_reports WHERE id LIKE 'mock-%'");
  db.exec("DELETE FROM monthly_reports WHERE id LIKE 'mock-%'");
  db.exec("DELETE FROM work_breakdown_items WHERE id LIKE 'mock-%'");
  db.exec("DELETE FROM projects WHERE id LIKE 'mock-%'");
  db.exec("DELETE FROM user_ai_settings WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'mock.%@daycraft.local')");
  db.exec("DELETE FROM user_profiles WHERE email LIKE 'mock.%@daycraft.local'");
  db.exec("DELETE FROM users WHERE email LIKE 'mock.%@daycraft.local'");

  const mockHash = bcrypt.hashSync('Mock@123456', 10);
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertProfile = db.prepare(
    `INSERT INTO user_profiles (id, email, full_name, role, created_at, updated_at, last_report_edit_at)
     VALUES (?, ?, ?, '["user"]', ?, ?, ?)`,
  );

  const memberIds = [];
  MEMBERS.forEach(([name, slug], index) => {
    const id = `mock-user-${pad(index + 1)}`;
    const email = `mock.${slug}@daycraft.local`;
    const createdAt = addDays(now, -320 + index * 9).toISOString();
    insertUser.run(id, email, mockHash, createdAt, createdAt);
    insertProfile.run(id, email, name, createdAt, createdAt, null);
    memberIds.push(id);
  });

  const insertProject = db.prepare(
    `INSERT INTO projects (id, name, code, description, user_id, created_at, updated_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // 团队项目：归属 mock 成员，供团队星图的“人员 → 项目”边使用
  const projectOwners = new Map();
  const teamProjectIds = TEAM_PROJECTS.map(([name, code], index) => {
    const id = `mock-team-project-${pad(index + 1)}`;
    const owner = memberIds[index % memberIds.length];
    const createdAt = addDays(now, -150 + index * 4).toISOString();
    const isActive = index % 7 === 6 ? 0 : 1;
    insertProject.run(id, name, code, `演示项目 · ${name}`, owner, createdAt, createdAt, isActive);
    projectOwners.set(id, owner);
    return id;
  });

  // 管理员项目：工作分解页面默认打开最新创建的那个（星环智能协作平台）
  const wbProjectIds = WB_PROJECTS.map(([name, code, description], index) => {
    const id = `mock-wb-project-${pad(index + 1)}`;
    const createdAt = new Date(now.getTime() - index * 3600 * 1000 - 60 * 1000).toISOString();
    insertProject.run(id, name, code, description, admin.id, createdAt, createdAt, 1);
    projectOwners.set(id, admin.id);
    return id;
  });

  const insertWorkItem = db.prepare(
    `INSERT INTO work_breakdown_items
     (id, project_id, name, description, parent_id, level, position, is_expanded,
      status, tags, members, progress_notes, user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let workItemCount = 0;
  wbProjectIds.forEach((projectId, projectIndex) => {
    let counter = 0;
    const projectCreatedAt = new Date(now.getTime() - projectIndex * 86400000);
    const insertNode = (name, description, parentId, level, position, tags, status, notes) => {
      counter += 1;
      const id = `mock-wb-item-${pad(projectIndex + 1)}-${pad(counter)}`;
      const createdAt = atTime(addDays(projectCreatedAt, level), 9 + (counter % 8), counter % 60);
      const memberCount = 2 + (counter % 3);
      const members = memberIds
        .slice((counter + projectIndex) % 6, (counter + projectIndex) % 6 + memberCount)
        .map((memberId) => MEMBERS[memberIds.indexOf(memberId)][0])
        .join('，');
      insertWorkItem.run(
        id,
        projectId,
        name,
        description,
        parentId,
        level,
        position,
        status,
        tags,
        members,
        notes,
        admin.id,
        createdAt,
        createdAt,
      );
      workItemCount += 1;
      return id;
    };

    TREE_TEMPLATE.forEach((top, topIndex) => {
      const topStatus = pick(['进行中', '进行中', '已完成', '未开始', '已暂停'], projectIndex * 10 + topIndex);
      const topId = insertNode(
        top.name,
        top.description,
        null,
        0,
        topIndex,
        top.tags,
        topStatus,
        topIndex % 3 === 0 ? NOTES[(projectIndex + topIndex) % NOTES.length] : '',
      );

      top.children.forEach(([childName, grandCount], childIndex) => {
        const childStatus = pick(STATUSES, projectIndex * 31 + topIndex * 7 + childIndex);
        const childId = insertNode(
          childName,
          `${top.name} · ${childName}的执行与验收`,
          topId,
          1,
          childIndex,
          top.tags,
          childStatus,
          childIndex % 2 === 0 ? NOTES[(projectIndex + childIndex + 1) % NOTES.length] : '',
        );

        for (let grandIndex = 0; grandIndex < grandCount; grandIndex += 1) {
          const suffix = TASK_SUFFIXES[grandIndex % TASK_SUFFIXES.length];
          const status = pick(STATUSES, projectIndex * 53 + topIndex * 11 + childIndex * 5 + grandIndex);
          insertNode(
            `${childName} · ${suffix}`,
            `${childName}${suffix}，输出可复用的交付物`,
            childId,
            2,
            grandIndex,
            top.tags,
            status,
            status === '已完成' || grandIndex % 2 === 0 ? NOTES[(projectIndex + grandIndex) % NOTES.length] : '',
          );
        }
      });
    });
  });

  const allProjectIds = [...teamProjectIds, ...wbProjectIds];
  const projectNames = new Map();
  db.prepare("SELECT id, name FROM projects WHERE id LIKE 'mock-%'").all().forEach((row) => {
    projectNames.set(row.id, row.name);
  });

  const insertDaily = db.prepare(
    'INSERT INTO daily_reports (id, user_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertItem = db.prepare(
    'INSERT INTO report_items (id, report_id, project_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
  );

  let dailyCount = 0;
  let reportItemCount = 0;
  const lastReportDateByUser = new Map();

  const seedDailyForUser = (userId, userKey, userIndex, active) => {
    // 日报只能引用本人项目，否则编辑时后端会以“包含不属于你的项目”拒绝保存
    const ownProjectIds = allProjectIds.filter((id) => projectOwners.get(id) === userId);
    if (ownProjectIds.length === 0) return;

    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = addDays(now, -offset);
      const day = date.getDay();
      if (day === 0 || day === 6) continue;
      // 保留 2 个成员本期完全无记录，用于展示灰色节点
      if (!active) continue;
      // 每人约 80% 的工作日提交日报
      if ((userIndex * 17 + offset * 13) % 10 < 2) continue;
      // 管理员可能已有真实日报，同一天跳过，避免 UNIQUE(user_id, date) 冲突
      if (db.prepare('SELECT 1 FROM daily_reports WHERE user_id = ? AND date = ?').get(userId, toDate(date))) {
        lastReportDateByUser.set(userId, toDate(date));
        continue;
      }

      const reportId = `mock-daily-${userKey}-${toDate(date)}`;
      const createdAt = atTime(date, 18, (userIndex * 7 + offset) % 60);
      insertDaily.run(reportId, userId, toDate(date), createdAt, createdAt);
      dailyCount += 1;
      lastReportDateByUser.set(userId, toDate(date));

      const itemCount = 1 + ((userIndex + offset) % 3);
      for (let n = 0; n < itemCount; n += 1) {
        const projectId = ownProjectIds[(userIndex * 5 + offset * 3 + n * 7) % ownProjectIds.length];
        const content = pick(DAILY_CONTENTS, userIndex * 19 + offset * 5 + n);
        insertItem.run(
          `mock-item-${userKey}-${toDate(date)}-${n + 1}`,
          reportId,
          projectId,
          `${content}（${projectNames.get(projectId)}）`,
          createdAt,
        );
        reportItemCount += 1;
      }
    }
  };

  MEMBERS.forEach((_, index) => {
    seedDailyForUser(memberIds[index], pad(index + 1), index + 1, index < 12);
  });
  // 管理员也产生一些日报，让团队星图的中心人员保持活跃
  seedDailyForUser(admin.id, 'admin', 0, true);

  const insertWeekly = db.prepare(
    `INSERT INTO weekly_reports (id, user_id, year, week_number, start_date, end_date, content, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMonthly = db.prepare(
    `INSERT INTO monthly_reports (id, user_id, year, month, start_date, end_date, content, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let weeklyCount = 0;
  let monthlyCount = 0;
  const activeUsers = [admin.id, ...memberIds.slice(0, 12)];

  activeUsers.forEach((userId, userIndex) => {
    for (let back = 0; back < 3; back += 1) {
      const date = addDays(now, -back * 7);
      const { year, week } = isoWeek(date);
      const { start, end } = weekBounds(date);
      // 管理员可能已有真实周报，同一周跳过，避免 UNIQUE(user_id, year, week_number) 冲突
      if (db.prepare('SELECT 1 FROM weekly_reports WHERE user_id = ? AND year = ? AND week_number = ?').get(userId, year, week)) {
        continue;
      }
      const projectA = projectNames.get(allProjectIds[(userIndex * 3 + back) % allProjectIds.length]);
      const projectB = projectNames.get(allProjectIds[(userIndex * 3 + back + 5) % allProjectIds.length]);
      const content = [
        `本周进展`,
        `1. ${projectA}：完成核心链路联调与回归，遗留问题 2 个；`,
        `2. ${projectB}：推进需求评审与方案确认，输出接口清单；`,
        `3. 团队协作：参与技术评审 2 次，完成知识沉淀 1 篇。`,
        ``,
        `下周计划`,
        `1. 完成遗留缺陷收敛并进入灰度；`,
        `2. 补齐自动化用例，覆盖关键业务分支；`,
        `3. 跟进数据口径确认与上线复盘。`,
        ``,
        `风险：${projectB} 依赖的上游接口排期存在不确定性。`,
      ].join('\n');
      insertWeekly.run(
        `mock-weekly-${pad(userIndex + 1)}-${year}-${week}`,
        userId,
        year,
        week,
        start,
        end,
        content,
        back === 0 ? 'draft' : 'generated',
        atTime(new Date(end), 17, 30),
        atTime(new Date(end), 17, 30),
      );
      weeklyCount += 1;
    }

    for (let back = 0; back < 2; back += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const { start, end } = monthBounds(date);
      // 管理员可能已有真实月报，同一月跳过
      if (db.prepare('SELECT 1 FROM monthly_reports WHERE user_id = ? AND year = ? AND month = ?').get(userId, date.getFullYear(), date.getMonth() + 1)) {
        continue;
      }
      const content = [
        `${date.getFullYear()} 年 ${date.getMonth() + 1} 月工作总结`,
        `本月围绕 ${projectNames.get(allProjectIds[userIndex % allProjectIds.length])} 与 ${projectNames.get(allProjectIds[(userIndex + 7) % allProjectIds.length])} 开展工作：`,
        `- 完成需求评审、技术方案与排期对齐；`,
        `- 交付核心功能并完成两轮回归测试；`,
        `- 优化关键链路性能，平均响应时间下降 15%；`,
        `- 沉淀复盘文档与可复用组件。`,
        `下月重点：推进灰度放量、完善监控告警、补齐质量门禁。`,
      ].join('\n');
      insertMonthly.run(
        `mock-monthly-${pad(userIndex + 1)}-${date.getFullYear()}-${date.getMonth() + 1}`,
        userId,
        date.getFullYear(),
        date.getMonth() + 1,
        start,
        end,
        content,
        'generated',
        atTime(new Date(end), 18, 0),
        atTime(new Date(end), 18, 0),
      );
      monthlyCount += 1;
    }
  });

  // 最近编辑时间：用于团队详情卡片展示
  const updateEdit = db.prepare('UPDATE user_profiles SET last_report_edit_at = ? WHERE id = ?');
  for (const [userId, date] of lastReportDateByUser.entries()) {
    updateEdit.run(atTime(new Date(`${date}T00:00:00`), 18, 30), userId);
  }

  db.exec('COMMIT');

  console.log('Mock 数据填充完成：');
  console.log(`  管理员项目：${wbProjectIds.length} 个，工作项：${workItemCount} 个`);
  console.log(`  团队项目：${teamProjectIds.length} 个（总计 ${allProjectIds.length} 个可关联项目）`);
  console.log(`  Mock 成员：${memberIds.length} 个（密码 Mock@123456）`);
  console.log(`  日报：${dailyCount} 篇 / 条目：${reportItemCount} 条`);
  console.log(`  周报：${weeklyCount} 篇 / 月报：${monthlyCount} 篇`);
  console.log(`  数据库：${dbPath}`);
} catch (error) {
  db.exec('ROLLBACK');
  console.error('Mock 数据填充失败：', error);
  process.exitCode = 1;
} finally {
  db.close();
}
