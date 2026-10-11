# DayCraft - Vite + Express 生产镜像（多阶段构建）
# 构建: docker build -t daycraft:latest .
# 运行: docker run -d -p 3000:3000 --env-file .env --name daycraft daycraft:latest

# ---------- 1. 依赖安装（pnpm + 国内源） ----------
# 用 node:24（与本地开发同版本）：node:sqlite 在 24 已稳定免 flag，
# 22.x 仍需 --experimental-sqlite，用 22 会导致容器启动即崩。
FROM node:24-alpine AS deps
WORKDIR /app
# esbuild（vite 构建用）在 alpine(musl) 下需要 gnu 兼容层，否则二进制无法执行
RUN apk add --no-cache libc6-compat
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@10 --activate \
 && pnpm config set registry https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN pnpm install --frozen-lockfile

# ---------- 2. 构建 ----------
FROM node:24-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=deps /app/node_modules ./node_modules
# pnpm workspace 每个子包各有一套 node_modules（symlink 进上面的 .pnpm store），
# 三个必须一起拷，只拷根的会导致 client/server 下找不到 tsc/vite 等二进制
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY . .

# VITE_* 在构建时 baked 进前端（deploy.sh 会自动传 .env 的值）
# 注意: AUTH_SECRET 等密钥故意不写进来，只能运行时 --env-file 传入，避免进镜像层
ARG VITE_AI_API_URL=https://api.openai.com/v1
ARG VITE_AI_API_KEY=sk-your-openai-api-key
ARG VITE_AI_MODEL_NAME=gpt-3.5-turbo
ARG VITE_AI_SYSTEM_PROMPT=你是一个智能助手，可以帮助用户生成日报、周报和月报。请根据用户提供的信息，生成专业、简洁的报告内容。
ARG VITE_AI_USER_PROMPT=请根据我的工作内容，生成一份专业的{report_type}。以下是我的工作记录：\n\n{report_content}
# 下面两个仅为“消费” deploy.sh 传进来的同名 build-arg，避免未使用告警；
# 单端口部署下前端用 window.location.origin 即可，VITE_SITE_URL 留空即可
ARG VITE_SITE_URL=
ARG VITE_API_PROXY=

ENV NODE_ENV=production

RUN pnpm -r build

# ---------- 3. 运行（最小镜像） ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# 仅部署 server 的生产依赖（含编译后的 dist）
# 注意 pnpm-lock.yaml 必须一起拷，否则 --frozen-lockfile 直接报错
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/
COPY --from=builder /app/server/package.json /app/server/package.json
COPY --from=builder /app/client/package.json /app/client/package.json
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/client/dist /app/client/dist
RUN corepack enable && corepack prepare pnpm@10 --activate \
 && pnpm config set registry https://registry.npmmirror.com \
 && pnpm --filter daycraft-server --prod install --frozen-lockfile \
 && chown -R nextjs:nodejs /app

# SQLite 数据目录（node:sqlite 文件库，运行时自动建库；需持久化请挂载卷）
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
