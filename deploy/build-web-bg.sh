#!/usr/bin/env bash
set -euo pipefail
pkill -f 'docker compose.*build' 2>/dev/null || true
cd /opt/CoPaddle/deploy
nohup docker compose -f docker-compose.prod.yml build web > /tmp/build-web.log 2>&1 &
echo "STARTED_PID=$!"
sleep 2
pgrep -af 'docker compose|pnpm' | head -5 || true
