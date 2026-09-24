#!/usr/bin/env bash
set -euo pipefail
cd /opt/CoPaddle/deploy

echo '== migrate =='
docker compose -f docker-compose.prod.yml up -d db
sleep 6
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -e POSTGRES_URL \
  web node_modules/.bin/drizzle-kit migrate || true

echo '== up all =='
docker compose -f docker-compose.prod.yml up -d
sleep 4
docker compose -f docker-compose.prod.yml ps
echo '--- health ---'
curl -sS -o /tmp/home.html -w 'home_http=%{http_code}\n' --max-time 15 http://127.0.0.1/ || true
curl -sS -o /dev/null -w 'sign_in_http=%{http_code}\n' --max-time 15 http://127.0.0.1/sign-in || true
docker logs gongjiang-web --tail 15 2>&1 || true
docker logs gongjiang-algo --tail 10 2>&1 || true
docker logs gongjiang-caddy --tail 10 2>&1 || true
