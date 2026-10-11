#!/bin/bash
# DayCraft Docker 一键部署脚本
# 用法:
#   ./deploy.sh              # 全量部署(构建+启动)
#   ./deploy.sh build        # 仅构建镜像
#   ./deploy.sh run          # 仅启动容器(需镜像已存在)
#   ./deploy.sh restart      # 重启容器
#   ./deploy.sh stop         # 停止并删除容器
#   ./deploy.sh logs         # 查看实时日志
#   ./deploy.sh clean        # 清理容器+镜像
#
# 环境变量(可选, 也可直接 export):
#   IMAGE_NAME=daycraft  CONTAINER_NAME=daycraft  APP_PORT=3000  ENV_FILE=.env

set -e

IMAGE_NAME="${IMAGE_NAME:-daycraft}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-daycraft}"
APP_PORT="${APP_PORT:-3000}"
ENV_FILE="${ENV_FILE:-.env}"

# 脚本所在目录即项目根目录
cd "$(dirname "$0")"

log()  { echo -e "\033[1;32m[DayCraft]\033[0m $1"; }
warn() { echo -e "\033[1;33m[Warn]\033[0m $1"; }
die()  { echo -e "\033[1;31m[Error]\033[0m $1" >&2; exit 1; }

check_docker() {
  command -v docker >/dev/null 2>&1 || die "未检测到 docker，请先安装 Docker: https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || die "Docker daemon 未运行，请先启动 Docker"
}

# 从 ENV_FILE 提取 VITE_* 作为 --build-arg（构建时烘焙进前端）
build_args() {
  local args=""
  if [ -f "$ENV_FILE" ]; then
    while IFS='=' read -r key value; do
      # 跳过空行/注释/export 前缀
      key=$(echo "$key" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^export[[:space:]]*//')
      [[ -z "$key" || "$key" == \#* ]] && continue
      [[ "$key" == VITE_* ]] || continue
      # 去掉值两侧空格和引号
      value=$(echo "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
      args="$args --build-arg $key=$value"
    done < "$ENV_FILE"
  else
    warn "未找到 $ENV_FILE，将使用 Dockerfile 默认值构建（VITE_* 可能为空）"
  fi
  echo "$args"
}

do_build() {
  log "构建镜像 ${IMAGE_NAME}:${IMAGE_TAG} ..."
  # shellcheck disable=SC2086
  docker build $(build_args) -t "${IMAGE_NAME}:${IMAGE_TAG}" .
  log "构建完成"
}

do_stop() {
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "停止并删除旧容器 ${CONTAINER_NAME} ..."
    docker rm -f "${CONTAINER_NAME}" >/dev/null
  fi
}

do_run() {
  local env_opt=""
  if [ -f "$ENV_FILE" ]; then
    env_opt="--env-file $ENV_FILE"
  else
    warn "未找到 $ENV_FILE，容器将无运行时环境变量"
  fi
  log "启动容器 ${CONTAINER_NAME} (宿主:${APP_PORT} -> 容器:3000，SQLite 数据存于命名卷 daycraft-data) ..."
  # shellcheck disable=SC2086
  docker run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    -p "${APP_PORT}:3000" \
    -v daycraft-data:/app/data \
    ${env_opt} \
    "${IMAGE_NAME}:${IMAGE_TAG}"
  log "启动成功: http://localhost:${APP_PORT}"
  docker ps --filter "name=${CONTAINER_NAME}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
}

do_logs() {
  docker logs -f "${CONTAINER_NAME}"
}

do_clean() {
  do_stop
  if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${IMAGE_NAME}:${IMAGE_TAG}$"; then
    log "删除镜像 ${IMAGE_NAME}:${IMAGE_TAG} ..."
    docker rmi "${IMAGE_NAME}:${IMAGE_TAG}"
  fi
  log "清理完成"
}

case "${1:-deploy}" in
  build)   check_docker; do_build ;;
  run)     check_docker; do_stop; do_run ;;
  restart) check_docker; do_stop; do_run ;;
  stop)    check_docker; do_stop; log "已停止" ;;
  logs)    do_logs ;;
  clean)   check_docker; do_clean ;;
  deploy|"")
    check_docker; do_build; do_stop; do_run ;;
  *) echo "用法: $0 [deploy|build|run|restart|stop|logs|clean]"; exit 1 ;;
esac
