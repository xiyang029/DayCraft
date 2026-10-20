# AGENTS.md — DayCraft 仓库协作说明

> 给 AI 编程代理看的：结构、命令、约定、坑。改代码前先读完。

## 1. 这是什么

本地化工作管理平台（项目 / 日报 / 周报月报 / 待办 / 工作分解 / 分享 / AI 润色）。
**Vite SPA + Express API，单仓双包，数据在本地 SQLite，零外部服务。**

```
DayCraft/
├── client/   前端：Vite 8 + React 19 + react-router-dom 7 + Tailwind 4（@tailwindcss/vite，CSS-first，无 config 文件）
│   └── src/{main.tsx, App.tsx, pages/, components/, contexts/, lib/, providers已删}
├── server/   后端：Express 5 + node:sqlite（内置模块）+ bcryptjs + cookie-parser
│   └── src/{index.ts, routes/, lib/}
├── data/     SQLite 库文件（默认 ./data/daycraft.db，git 忽略）
├── scripts/  backup.ps1 / restore.ps1（SQLite 备份恢复）
│             smoke-all.ps1（全接口冒烟，152 项断言）
└── db_backups/  备份产物目录（git 忽略，可整目录删）
```

历史：由 Next.js 全栈迁移而来，`next/*` 已彻底清除，不要再引回来。

面向人的用法说明（安装、环境变量、部署、API 一览）在 `README.md`，**别在两处各维护一份**：命令细节改 README，本文件只记代理容易踩的坑。

## 2. 常用命令（仓库根，pnpm workspace）

```bash
pnpm dev            # = pnpm dev:all，一键起前后端（见下端口规则）
pnpm -r build       # 全构建（client: tsc + vite build；server: tsc）
pnpm start          # 生产启动（NODE_ENV=production，单端口 :3000）
pnpm -r typecheck   # 双包类型检查，改完代码必跑
```

冒烟（需 pwsh 7+，隔离库，不污染真实数据）：

```powershell
# 终端1：起隔离 server
$env:NODE_ENV='production'; $env:PORT='3002'; $env:SQLITE_DB_PATH='F:\DayCraft\smoke_test.db'; node server\dist\index.js
# 终端2：跑全量
.\scripts\smoke-all.ps1 -Base http://localhost:3002
# 跑完：杀进程 + 删 smoke_test.db*
```

备份 / 恢复：命令与参数见 `README.md`「备份与恢复」。改这两个脚本时要知道的坑：

- 用 `node:sqlite` 的 `VACUUM INTO` 做快照，不依赖 sqlite3 CLI；`DatabaseSync` **没有** `.backup()` 方法。
- 备份**不用停服**（只读快照，WAL 模式安全）；**恢复必须先停服**，脚本会探 `PORT`/`SERVER_DEV_PORT` 两个端口，占着就拒绝执行。
- 恢复前自动把当前库备份成 `db_backups\<时间戳>-pre-restore\`，写坏可回退。
- 别用 `Copy-Item daycraft.db` 手工备份——WAL 里没 checkpoint 的数据会丢，`VACUUM INTO` 不会。
- 恢复会连 `-wal` / `-shm` 一起删，避免旧 WAL 覆盖新库。
- 脚本内的 node 片段靠 here-string `@'...'@` 传（`node -e` 直接写多行必炸，见第 7 节）。

## 3. 端口规则（server/src/index.ts，勿改逻辑）

- **开发**：server 固定 `:3001`（或 `SERVER_DEV_PORT`），**忽略 `.env` 的 `PORT`**；
  client `:5173`，`/api` 经 vite 代理转发，浏览器只用一个端口。
- **生产**（`NODE_ENV=production`）：用 `PORT`（默认 3000），server 同时托管 `client/dist` + SPA fallback。
- `.env` 的 `PORT=3000` 只对生产生效。

## 4. 后端约定（server/src）

- 路由按领域拆文件，挂载点见 `index.ts`（如 `/api/admin` → `routes/admin.ts`）。
  一个文件可导出多个 Router（如 `settings.ts` 导出 `aiSettingsRouter`）。
- 鉴权固定三行（`requireUser` / `requireAdmin` 返回 `AuthResult`）：
  ```ts
  const checked = await requireUser(req);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  const user = checked.user; // 之后只用 user.id
  ```
- 查询参数用 `q(req, name)` 助手（处理 string|string[]），`req.params.x` 取路径参数，
  `req.body as {...}` 取 body（`express.json` 已全局启用）。
- **每个 handler 必须 try/catch**（未捕获异常会炸掉整个进程——有过 `GET /me` 血案）。
- 错误文案/状态码与旧 Next 版保持逐字一致（前端依赖文案做提示）。
- `session.ts`：`getCurrentUser` 会查库（被删账号的旧 token 直接视为未登录）；
  `setSessionCookie` 的 `Secure` **只认 `COOKIE_SECURE=true`**，禁止绑 `NODE_ENV`
  （局域网 HTTP 部署绑 NODE_ENV 会导致登录态全灭，有过血案）。
- DB：`lib/database.ts` 单例，`lib/schema.ts` 建表（`CREATE TABLE IF NOT EXISTS`），
  删表需求走 `database.ts` 里的 `DROP TABLE IF EXISTS` 迁移行（幂等）。
  用户相关外键全部 `ON DELETE CASCADE`，删 `users` 主行即级联清数据。
- 验证码（`lib/captcha.ts`）：4 位数字字母、SQLite 落库、一次性核销。
  **禁止改回内存 Map**——各路由独立打包/多进程下内存不共享，签发后核销必失败（有过血案）。
- `lib/types.ts` 与 `client/src/lib/db/types.ts` 是两份同名类型（前后端各一份），改表结构两边同步。

## 5. 前端约定（client/src）

- 路由表在 `App.tsx`：`RequireAuth`（`/dashboard/*` 未登录踢 `/login`）、
  `RequireGuest`（已登录访问登录系/首页踢 dashboard）。`DashboardLayout` 用 `<Outlet/>`。
- 所有后端调用走 `lib/api.ts`（`apiGet/apiPost/apiPut/apiDelete`，401 自动跳登录）。
  不要祼写 `fetch('/api/...')`（`auth-context` 历史遗留除外）。
- 登录/注册/重置密码页用 `components/captcha-input.tsx`（文本直显验证码，不分大小写）。
- 登录成功后必须 `await refreshSession()` 再 `navigate`，
  否则守卫看到旧 `user=null` 会踢回登录页（有过血案）。
- 环境变量全部 `import.meta.env.VITE_*`；不要用 `process.env`。
- 管理员 badge 只显示最高权限（admin 优先），不要 map 整个 role 数组。
- 危险操作（删用户、改角色）必须用确认框（删除类用 `components/ui/alert-dialog`，普通确认用 `components/ui/dialog`，必须带 Title）；
  自己那一行按钮禁用，后端同样拦截（400）。
- 风格：Tailwind 4 + shadcn（`components/ui`，**base** 版，不是 radix）；toast 用 `components/ui/toast`
  的 manager（`import { toast } from "@/components/ui/toast"`，
  `toast.add({ title, type: 'success' | 'error' | 'info' })`，`main.tsx` 挂一次 `<Toaster />`），
  不用 `sonner`（依赖已删）；
  旧 shadcn `toast/use-toast` 已删，别引回来。
- UI 组件强约束：页面/业务组件（`pages/`、`components/captcha-input.tsx`、`components/work-breakdown/`、
  `App.tsx`）**只能用 `components/ui/` 内已有组件**，禁止手写原生
  `<button>/<input>/<select>/<textarea>` + tailwind class 冒充组件（如手写搜索框、表单输入框、
  spinner、select 下拉）。缺组件时先找 ui 内最接近的（`Input/Textarea/Checkbox/Select/Spinner/Badge/Card`
  等）组合，确实没有再按下一条安装。
- `components/ui/` 源码**禁止手改**（包括加 `forwardRef`、改样式、改 API）。
  新增/更新组件唯一合法途径是 shadcn CLI（在 `client/` 下执行，如
  `pnpm dlx shadcn@latest add button --overwrite`），改完跑 `pnpm -r typecheck`。
  CLI 覆盖会丢本地补丁——有本地补丁需求先提出来讨论，不要静默手改。
- 图标只用 `lucide-react`（统一 `*Icon` 命名，如 `PencilIcon`/`TrashIcon`/`FlagIcon`），
  禁止 emoji/字符画冒充图标（如 🏁/💡/✅/⚠️，一律换 `FlagIcon`/`LightbulbIcon` 等 lucide 同义图标）。
  非 `*Icon` 别名导入（`Eye`/`Clock`/`Calendar` 等）统一写成 `Eye as EyeIcon` 形式，调用点只出现 `*Icon`。
- 表单强制使用 `components/ui/field.tsx`：每个字段一律
  `<Field><FieldLabel/><Input/Textarea/Select/Checkbox/><FieldDescription?/><FieldError/></Field>`，
  禁止手写 `<label>` + `<p className="text-red-500">` 裸组合；横排复选/单选行用
  `<Field orientation="horizontal">`；状态徽章（已删除/活跃等）用 `Badge`，不手写
  `<span className="text-red-500 bg-red-50">`。
- Select（base 版血案）：**必须显式传 `items`**（`{ label, value }[]` 或 `Record<value, label>`），
  否则 `SelectValue` 只显示 raw value（如 `admin` / `__all` / 项目 id），不显示 label。
  动态选项从同一数据源 map 出来（哨兵 `__all`/`__none` 也要含进去）；
  `SelectItem` 必须包在 `SelectGroup` 内；
  `SelectContent` 只收 `side/sideOffset/align/alignOffset/alignItemWithTrigger`（`position/avoidCollisions` 等旧属性会直接报类型错）；
  `onValueChange` 签名是 `(value: string | null, details)`，`setState` 包一层 `(v) => setX(v ?? '')`。
- `components/ui` 的 wrapper（如 Button）上游是普通函数组件（面向 React 19 的 ref-as-prop，
  无 `React.forwardRef`）——**不要手改加 `forwardRef`**（违反上一条 ui 禁止手改约束）。
  Base UI 的 Trigger/Close 类组件经 `render` prop 给目标塞 ref，若目标是未把 ref 转发到 DOM 的普通函数组件，
  ref 仍会失效（Tooltip/DropdownMenu/Dialog 都有过血案）。
  正确修法一律在**调用侧**：`render={...}` 的目标只能是原生元素（如 `button` + `buttonVariants()` 取样式）、
  forwardRef 组件或 react-router `Link`，不要传普通函数组件（如 `render={<Button/>}` 禁止，
  改为 `render={<button className={cn(buttonVariants(...))} .../>}`）。同理 react-hook-form 的
  `register()` 含 ref，不能直接 spread 到无 forwardRef 的 ui `Input` 上，改用 `Controller`。
- DropdownMenu 的 `DropdownMenuLabel` 必须放在 `DropdownMenuGroup` **里面**（Label/Item/CheckboxItem 都一样），
  直接挂在 `DropdownMenuContent` 下会在点击展开时整个页面崩溃（`MenuGroupContext is missing`，有过血案）。
- 已下线功能不要复活：公开分享全链路（`work_breakdown_shares`/`work_breakdown_share_projects` 表 + `/api/work-breakdown/share` + `/api/share/:token` + ShareDialog/SharePage/设置共享页）与
  WBS 文件导入导出（Excel/XMind 方法 + `xlsx`/`jszip`/`file-saver` 依赖）已彻底删除，表由 `database.ts` 迁移行 DROP。

## 6. 环境变量

**完整清单在 `README.md` 的「环境变量」表，不在这里重复。** 代理只需额外记住两条：

- `SERVER_DEV_PORT`（默认 3001）只在开发生效；`.env` 的 `PORT` 只对生产生效。
- `COOKIE_SECURE` 只认字面 `true`，禁止绑 `NODE_ENV`（局域网 HTTP 部署会登录态全灭，有过血案）。

首个注册用户自动成为管理员（`auth.ts` 的 `isFirstUser` 逻辑）。

## 7. Windows / PowerShell 坑

- shell 跑的是 pwsh（非 cmd），`head/sed/grep` 不可用，用 `Select-Object` / `python` 代替。
- `node -e` 内联多行/引号必炸（`scripts/*.ps1` 里靠 here-string `@'...'@` 传），含引号时写成 `.js` 文件再跑。
- `python -c` 内联多行/引号必炸，复杂逻辑一律先 `write` 脚本文件再 `python xxx.py`，用完删除。
- 双引号字符串里 `$var?xxx` 会被解析成空（如 `"$tok?password="`），URL 拼接用 `${tok}` 花括号或 `+` 拼接。
- 测试脚本必须 pwsh 7+（`smoke-all.ps1` 用了 `-SkipHttpErrorCheck`，Windows PowerShell 5.1 会把 UTF-8 中文解析成乱码）。
- `tsx watch` 会自动加载并 **覆盖式** 注入 `.env`（override:true），dev 调端口不要指望 `$env:PORT`。
- 端口被占（EADDRINUSE）先 `Get-Process node | Stop-Process`，再确认日志 `listening on` 后才跑测试。

## 8. 改动 checklist

- [ ] `pnpm -r typecheck` 通过
- [ ] 后端改动：`pnpm --filter daycraft-server build` + `smoke-all.ps1` 全绿（小改前端可只 typecheck）
- [ ] 前端改动：`vite build` 通过（chunk 体积警告是已知常态，可忽略）
- [ ] 新增/删除接口：同步 `README.md` API 一览 + `smoke-all.ps1` 断言
- [ ] 删表/改表：`schema.ts` + 迁移行 + 前后端 `types.ts` 同步
- [ ] 改表结构/迁移前先 `.\scripts\backup.ps1 -Label pre-migrate`（恢复见第 2 节）
- [ ] 不要提交 `data/*.db*`、`db_backups/`、`smoke_test.db*`、临时 `.py/.js` 脚本
