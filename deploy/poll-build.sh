#!/usr/bin/env bash
set -euo pipefail
for i in $(seq 1 20); do
  if ! pgrep -f 'docker compose.*build web' >/dev/null 2>&1; then
    echo "BUILD_EXITED"
    tail -50 /tmp/build-web.log
    echo '---IMAGES---'
    docker images
    exit 0
  fi
  echo "--- tick $i $(date +%H:%M:%S) ---"
  tail -4 /tmp/build-web.log || true
  sleep 30
done
echo "STILL_RUNNING"
tail -20 /tmp/build-web.log || true
