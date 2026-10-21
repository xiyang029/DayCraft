# AGENTS.md — DayCraft 仓库协作说明

> 给 AI 编程代理看的：结构、命令、约定、坑。改代码前先读完。面向人的说明（安装、环境变量、部署、API 一览）在 `README.md`，别在两处各维护一份。

## 1. 这是什么

本地化工作管理平台（项目 / 日报 / 周报月报 / 工作分解 / AI 润色）。**Vite SPA + Express API，单仓双包（pnpm workspace），数据在本地 SQLite，零外部服务。**

```
DayCraft/
├── client/    Vite 8 + React 19 + react-router-dom 7 + Tailwind 4（CSS-first，无 config 文件）；src/{main.tsx,App.tsx,pages,components,contexts,lib}
└── server/    Express 5 + node:sqlite + bcryptjs + cookie-parser；src/{index.ts,routes,lib} · data/ SQLite 库（git 忽略） · scripts/ backup.ps1 / restore.ps1 / smoke-all.ps1（全接口冒烟，152 项断言） · db_backups/ 备份产物（git 忽略）
```

历史：由 Next.js 全栈迁移而来，`next/*` 已清除，不要再引回来。

## 2. 常用命令（仓库根）

```bash
pnpm dev            # = dev:all，一键起前后端
pnpm -r build       # 全构建（client: tsc + vite build；server: tsc）
pnpm start          # 生产启动（NODE_ENV=production，单端口 :3000）
pnpm -r typecheck   # 双包类型检查，改完必跑
```

冒烟（需 pwsh 7+，隔离库，不污染真实数据）：先 `$env:NODE_ENV='production'; $env:PORT='3002'; $env:SQLITE_DB_PATH='F:\DayCraft\smoke_test.db'; node server\dist\index.js`，再 `.\scripts\smoke-all.ps1 -Base http://localhost:3002`；跑完杀进程 + 删 `smoke_test.db*`。

备份 / 恢复：参数见 `README.md`「备份与恢复」。坑：

- 快照用 `node:sqlite` 的 `VACUUM INTO`（`DatabaseSync` 没有 `.backup()`，不依赖 sqlite3 CLI）；备份不用停服（只读快照，WAL 安全），**恢复必须先停服**（脚本探 `PORT`/`SERVER_DEV_PORT`，占着就拒跑），且会连 `-wal`/`-shm` 一起删。
- 恢复前自动备份到 `db_backups\<时间戳>-pre-restore\`；别手工 `Copy-Item daycraft.db`（WAL 里未 checkpoint 的数据会丢）。

## 3. 端口规则（server/src/index.ts，勿改逻辑）

- **开发**：server 固定 `:3001`（或 `SERVER_DEV_PORT`），**忽略 `.env` 的 `PORT`**；client `:5173`，`/api` 走 vite 代理。
- **生产**（`NODE_ENV=production`）：用 `PORT`（默认 3000），server 同时托管 `client/dist` + SPA fallback；`.env` 的 `PORT` 只对生产生效。

## 4. 后端约定（server/src）

- 路由按领域拆文件，挂载点见 `index.ts`；一个文件可导出多个 Router（如 `settings.ts`）。
- 鉴权固定三行（`requireUser` / `requireAdmin` 返回 `AuthResult`）：`const checked = await requireUser(req); if (!checked.ok) return res.status(checked.status).json({ error: checked.error }); const user = checked.user; // 之后只用 user.id`。
- 查询参数用 `q(req, name)`，路径参数 `req.params.x`，body 用 `req.body as {...}`（`express.json` 已全局启用）；**每个 handler 必须 try/catch**（未捕获异常会炸掉整个进程——有过血案），错误文案/状态码与旧 Next 版逐字一致（前端依赖文案做提示）。
- `session.ts`：`getCurrentUser` 会查库（被删账号的旧 token 视为未登录）；`Secure` **只认 `COOKIE_SECURE=true`**，禁止绑 `NODE_ENV`。
- DB：`lib/database.ts` 单例、`lib/schema.ts` 建表；删表走 `database.ts` 的 `DROP TABLE IF EXISTS` 迁移行（幂等）；用户相关外键全 `ON DELETE CASCADE`（删 users 主行即级联清数据）。
- 验证码（`lib/captcha.ts`）落 SQLite、一次性核销，**禁止改回内存 Map**（各路由独立打包/多进程下内存不共享）。
- `lib/types.ts` 与 `client/src/lib/db/types.ts` 是前后端两份同名类型，改表结构两边同步。

## 5. 前端约定（client/src）

- 路由表在 `App.tsx`：`RequireAuth`（`/dashboard/*` 未登录踢 `/login`）、`RequireGuest`（已登录踢 dashboard）；`DashboardLayout` 用 `<Outlet/>`。
- 所有后端调用走 `lib/api.ts`（`apiGet/apiPost/apiPut/apiDelete`，401 自动跳登录），不要裸写 `fetch('/api/...')`。
- 登录/注册/重置密码用 `components/captcha-input.tsx`（文本直显验证码，不分大小写）；登录成功后必须 `await refreshSession()` 再 `navigate`，否则守卫看到旧 `user=null` 会踢回登录页。
- 环境变量全部 `import.meta.env.VITE_*`，不要用 `process.env`；管理员 badge 只显示最高权限（admin 优先），不要 map 整个 role 数组。
- 危险操作（删用户、改角色）必须确认框（删除类用 `ui/alert-dialog`，普通确认用 `ui/dialog`，必须带 Title）；自己那行按钮禁用，后端同样拦截（400）。
- 风格：Tailwind 4 + shadcn（`components/ui`，**base** 版，不是 radix）；toast 用 `ui/toast` 的 manager（`toast.add({ title, type: 'success' | 'error' | 'info' })`，`main.tsx` 挂一次 `<Toaster />`），不用 `sonner`。
- **`components/ui/` 源码禁止手改**（含加 `forwardRef`、改样式、改 API）；新增/更新组件唯一合法途径是 shadcn CLI（`client/` 下 `pnpm dlx shadcn@latest add <x> --overwrite`）。需要本地补丁先提出来讨论——CLI 覆盖会丢补丁，不要静默手改。
- 页面/业务组件（`pages/`、`captcha-input.tsx`、`components/work-breakdown/`）只能用 `components/ui/` 已有组件，禁止手写原生 `<button>/<input>/<select>/<textarea>` + tailwind class 冒充组件（缺组件先找 ui 里最接近的组合）；图标只用 `lucide-react`，统一 `*Icon` 命名（非 `*Icon` 别名写成 `Eye as EyeIcon`，调用点只出现 `*Icon`），禁止 emoji/字符画。
- 表单强制 `ui/field.tsx`：`<Field><FieldLabel/><Input|Textarea|Select|Checkbox/><FieldDescription?/><FieldError/></Field>`，横排用 `<Field orientation="horizontal">`；状态徽章用 `Badge`，不手写 `<span className="text-red-500">`。
- Select（base 版）：**必须显式传 `items`**（`{label,value}[]` 或 Record），否则 `SelectValue` 只显示 raw value；`SelectItem` 必须包在 `SelectGroup` 内；`SelectContent` 只收 `side/sideOffset/align/alignOffset/alignItemWithTrigger`；`onValueChange` 签名是 `(value: string | null, details)`。
- ui wrapper 面向 React 19（ref-as-prop，无 `forwardRef`）：Base UI 的 Trigger/Close 经 `render` 传目标时只能是原生元素（`button` + `buttonVariants()`）、forwardRef 组件或 react-router `Link`，**禁止 `render={<Button/>}`**；`register()` 含 ref，不能直接 spread 到 ui `Input`，改用 `Controller`。
- `DropdownMenuLabel` 必须放在 `DropdownMenuGroup` 里（Label/Item/CheckboxItem 同理），直接挂 `DropdownMenuContent` 下展开时会崩。
- 已下线功能不要复活：公开分享全链路（share 表 + `/api/work-breakdown/share` + `/api/share/:token` + ShareDialog/SharePage）与 WBS 导入导出（`xlsx`/`jszip`/`file-saver`），表由迁移行 DROP。

## 6. 环境变量

完整清单在 `README.md`「环境变量」，此处不重复。代理额外记两条：`SERVER_DEV_PORT`（默认 3001）只在开发生效、`.env` 的 `PORT` 只对生产生效；`COOKIE_SECURE` 只认字面 `true`，禁止绑 `NODE_ENV`。首个注册用户自动成为管理员（`auth.ts` 的 `isFirstUser`）。

## 7. Windows / PowerShell 坑

- shell 是 pwsh（非 cmd），`head/sed/grep` 不可用，用 `Select-Object` / `python` 代替；`node -e` / `python -c` 内联多行或引号必炸，PS 脚本里用 here-string `@'...'@`，复杂逻辑先写 `.js`/`.py` 文件再跑（用完删）。
- 双引号里 `$var?xxx` 会被解析成空，URL 拼接用 `${var}` 或 `+`；`tsx watch` 会覆盖式注入 `.env`（override:true），dev 调端口别指望 `$env:PORT`。
- 测试脚本必须 pwsh 7+（`smoke-all.ps1` 用 `-SkipHttpErrorCheck`；5.1 会把 UTF-8 中文解析成乱码）；端口被占（EADDRINUSE）先 `Get-Process node | Stop-Process`，确认日志 `listening on` 后再跑测试。

## 8. 改动 checklist

- [ ] `pnpm -r typecheck` 通过；前端改动另跑 `vite build`（chunk 体积警告是常态，可忽略），后端改动跑 `pnpm --filter daycraft-server build` + `smoke-all.ps1` 全绿
- [ ] 新增/删除接口：同步 `README.md` API 一览 + `smoke-all.ps1` 断言
- [ ] 删表/改表：`schema.ts` + 迁移行 + 前后端 `types.ts` 同步；迁移前先 `.\scripts\backup.ps1 -Label pre-migrate`
- [ ] 不提交 `data/*.db*`、`db_backups/`、`smoke_test.db*`、临时 `.py/.js` 脚本
