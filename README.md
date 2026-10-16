# DayCraft · 专业工作管理平台

集项目管理、日报撰写、周报月报生成、进度跟踪于一体的本地化工作平台。
数据存于本地 SQLite，无需外部服务，开箱即用。

- 项目管理：多项目、激活/停用、编码查重
- 工作分解（WBS）：5 级树形结构、拖拽排序、移动、工作导图
- 日报：按日填写
- 周报/月报/项目周报：由日报自动聚合生成，支持 AI 润色（自定义模型）
- 系统管理：用户一览、活跃统计、角色管理

## 架构

```
DayCraft/
├── client/   前端 SPA：Vite + React 18 + react-router-dom 6 + Tailwind CSS
├── server/   后端 API：Express 4 + node:sqlite（内置模块，零数据库依赖）
├── data/     SQLite 库文件（默认 ./data/daycraft.db，git 忽略）
├── scripts/  备份 / 恢复 / 全接口冒烟测试
└── db_backups/  备份产物（git 忽略）
```
单端口部署：`server` 同时提供 `/api/*` 并托管 `client/dist` 构建产物，Cookie 同源，无 CORS 问题。
前端 401 时自动跳登录页；`/dashboard/*` 需登录（全站无公开页面）。

> 本项目由 Next.js 全栈迁移而来（Vite + Express），旧 Next.js 代码已移除。

## 快速开始

环境要求：Node.js 22+、pnpm 10+。

```bash
# 1. 安装依赖（工作区统一安装）
pnpm install

# 2. 配置环境变量
cp .env.example .env        # Windows: Copy-Item .env.example .env
# 生产环境务必修改 AUTH_SECRET 为随机长字符串

# 3. 启动开发环境（两个终端，或一个终端跑 pnpm dev）
pnpm dev
# client → http://localhost:5173（/api 代理到 server）
# server → http://localhost:3001
```

生产运行：

```bash
pnpm -r build          # 构建前端 + 后端
pnpm start             # 启动 server（默认 :3000，同时托管前端）
```

Docker 一键部署见 `deploy.sh`（`./deploy.sh` 全量部署；SQLite 数据存于命名卷 `daycraft-data`）。

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 生产 server 监听端口（开发固定 `:3001`，忽略此值） | `3000` |
| `SERVER_DEV_PORT` | 开发 server 端口 | `3001` |
| `SQLITE_DB_PATH` | 数据库文件路径（相对仓库根解析） | `./data/daycraft.db` |
| `AUTH_SECRET` | 会话 JWT 签名密钥，生产必改 | — |
| `COOKIE_SECURE` | 仅 HTTPS 对外时设 `true`；HTTP 部署必须关闭 | 关 |
| `SITE_URL` / `VITE_SITE_URL` | 站点绝对地址（留空按请求 Host 自动判断） | — |
| `AI_API_URL` / `AI_MODEL_NAME` … | 新用户 AI 默认设置（注册时写入 `user_ai_settings`，仅自定义 AI） | OpenAI 兼容地址 |
| `VITE_API_PROXY` | 仅开发期：vite 把 `/api` 代理到的地址 | `http://localhost:3001` |

表结构由 `server/src/lib/schema.ts` 在首次启动时自动创建，无需手动建表。
首个注册的用户自动成为管理员。

## 常用命令

```bash
pnpm dev                # 同时启动 client + server（开发）
pnpm -r build           # 构建全部
pnpm start              # 启动生产 server
pnpm -r typecheck       # 双包类型检查

.\scripts\backup.ps1                             # 备份数据库到 .\db_backups\<时间戳>\
.\scripts\backup.ps1 -Label before-upgrade       # 带标签
.\scripts\restore.ps1 -Backup db_backups\20260101-120000
# 恢复（先停服，会自动备份当前库）

.\scripts\smoke-all.ps1 -Base http://localhost:3001
# 全接口冒烟测试（107 项断言，覆盖全部路由×方法×异常分支，需 pwsh 7+）
```

## API 一览

- 认证：`GET /api/auth/captcha`、`POST /api/auth/{signup,login,logout,reset-password}`、`GET /api/auth/me`
  - 登录/注册/重置密码均需 4 位数字字母验证码（页面直显，不区分大小写，一次性，5 分钟有效）
- 项目：`/api/projects[/:id]`（GET/POST/PUT/DELETE）
- 日报：`/api/daily-reports[/:id]`（按日期 upsert、删除）
- 周报/月报：`/api/weekly-reports`、`/api/monthly-reports`
- 工作分解：`/api/work-breakdown/items[/:id]`（含批量位置）
- 设置：`/api/ai-settings`（GET/PUT）
- AI 代理（需登录，OpenAI 兼容）：`POST /api/ai`（润色，透传 `/chat/completions`）、`POST /api/ai/test`（连通性，调上游 `/models`）
  - key 由用户在设置页自填自管，服务端只转发不落库；Anthropic 原生接口不兼容，走代理会失败
- 管理（admin）：`GET /api/admin/overview`、`PUT /api/admin/users/:id`（改角色，禁改自己）、`DELETE /api/admin/users/:id`（删号并级联清数据，禁删自己）
- 团队报告（admin）：`GET /api/admin/reports/graph`（3D 星图：人员 / 项目 / 关联边，`start`+`end` 限定区间，默认近 30 天）
  - `GET /api/admin/reports/daily`（全员日报明细，可按 `user_id` / `project_id` 过滤，`with_items=0` 可关明细）
  - `GET /api/admin/reports/weekly`（全员周报 / 月报，`kind=weekly|monthly`）
- 用户：`GET /api/users`（登录可见，仅 id/full_name/email，供参与人员等选择真实人员）

## 备份与恢复

```powershell
.\scripts\backup.ps1                             # 备份到 .\db_backups\<时间戳>\
.\scripts\restore.ps1 -Backup db_backups\20260101-120000  # 传备份目录或 .db 文件均可
```

要点：

- 备份走 `node:sqlite` 的 `VACUUM INTO`，**不需要停服**（只读快照，WAL 模式下安全），也不依赖 `sqlite3` CLI。
- 不要直接 `Copy-Item data/daycraft.db` —— WAL 里未 checkpoint 的数据会丢，快照方式不会。
- 恢复**必须先停服**，脚本会探测 `PORT` / `SERVER_DEV_PORT`，端口占用直接拒绝执行。
- 恢复前自动把当前库备份成 `db_backups\<时间戳>-pre-restore\`，写坏可回退；恢复时连 `-wal` / `-shm` 一并清除。
- 校验和见每次备份目录下的 `meta.txt`（来源、时间、大小、sha256）。

## 目录说明

- `client/src/pages`：全部页面（路由见 `client/src/App.tsx`）
- `client/src/{components,contexts,lib,providers}`：UI 组件、认证上下文、API 封装、工具库
- `server/src/routes`：按领域划分的 Express 路由
- `server/src/lib`：SQLite 连接、表结构、JWT 会话、验证码、归属校验
