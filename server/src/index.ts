import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';

import { getDb, getDbPath } from './lib/database';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import adminReportsRouter from './routes/admin-reports';
import usersRouter from './routes/users';
import { aiSettingsRouter } from './routes/settings';
import { aiRouter } from './routes/ai';
import projectsRouter from './routes/projects';
import { dailyReportsRouter } from './routes/daily';
import { weeklyRouter, monthlyRouter } from './routes/weekly';
import { itemsRouter } from './routes/workbreakdown';

// 仓库根目录（src 和 dist 均为两级：server/src→server→root，server/dist→server→root）
const ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, 'server', '.env'), override: true });

// SQLITE_DB_PATH 为相对路径时一律相对仓库根解析（与旧 Next.js 版一致）
if (process.env.SQLITE_DB_PATH && !path.isAbsolute(process.env.SQLITE_DB_PATH)) {
  process.env.SQLITE_DB_PATH = path.join(ROOT, process.env.SQLITE_DB_PATH);
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/reports', adminReportsRouter);
app.use('/api/users', usersRouter);
app.use('/api/ai-settings', aiSettingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/daily-reports', dailyReportsRouter);
app.use('/api/weekly-reports', weeklyRouter);
app.use('/api/monthly-reports', monthlyRouter);
app.use('/api/work-breakdown/items', itemsRouter);

// 未匹配的 /api 返回 JSON 404（避免落入 SPA fallback）
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 单端口部署：托管 Vite 构建产物 client/dist（含 SPA fallback）
const distDir = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`[server] 托管前端静态目录: ${distDir}`);
} else {
  console.log('[server] 未找到 client/dist，仅提供 API（开发模式请用 Vite dev server）');
}

// 端口规则：生产用 PORT（默认 3000），开发固定 3001（或 SERVER_DEV_PORT），
// 互不干扰 —— .env 里的 PORT 只对生产生效。
const isProd = process.env.NODE_ENV === 'production';
const PORT = isProd
  ? Number(process.env.PORT || 3000)
  : Number(process.env.SERVER_DEV_PORT || 3001);
app.listen(PORT, '0.0.0.0', () => {
  try {
    getDb();
    console.log(`[server] SQLite 就绪: ${getDbPath()}`);
  } catch (error) {
    console.error('[server] 数据库初始化失败:', error);
    process.exit(1);
  }
  console.log(`[server] listening on :${PORT}`);
});
