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
# 迁移失败必须中止：以前这里写了 `|| true`，迁移挂了照样 `up -d` 起新版本，
# 结果是新代码对着旧表结构跑，报错发生在用户点击的那一刻而不是部署时。
if ! docker compose -f docker-compose.prod.yml run --rm web node_modules/.bin/drizzle-kit migrate; then
  echo "!! 数据库迁移失败，已中止部署。请修好迁移后重跑；旧版本容器未被替换。" >&2
  exit 1
fi

echo "== up =="
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
echo "部署完成：http://<服务器IP>/"
