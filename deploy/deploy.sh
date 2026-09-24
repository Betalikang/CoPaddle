#!/usr/bin/env bash
# 部署入口：在服务器 /opt/copaddle/deploy 下执行
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "缺少 deploy/.env，请先拷贝 env.example 并填写"
  exit 1
fi

# 生成初始库结构（幂等迁移）
echo "== drizzle migrate =="
docker compose -f docker-compose.prod.yml build web algo
docker compose -f docker-compose.prod.yml up -d db
sleep 5
# 在 web 容器外跑迁移：临时用 web 镜像执行 npx drizzle
docker compose -f docker-compose.prod.yml run --rm web node_modules/.bin/drizzle-kit migrate || true

echo "== up =="
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
echo "部署完成：http://<服务器IP>/"
