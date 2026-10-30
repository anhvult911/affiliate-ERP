#!/usr/bin/env bash
#
# Deploy one commit to this box and restart the app (P5-6).
#
# Runs ON the VPS as the `deploy` user, called by .github/workflows/deploy.yml after CI
# passes on main. It is safe to run by hand:
#
#   sudo -u deploy bash /opt/affiliate-erp/scripts/deploy-vps.sh origin/main
#
# Rules that matter on this shared box:
#   - only affiliate-app is restarted (sudoers allows nothing else);
#   - nginx, PM2 (mkt-dashboard), and the trippool/mkt-tools containers are never touched;
#   - the build is capped at 1 GB of heap so it cannot starve the other services;
#   - a failed health check rolls back to the commit that was running before.
set -euo pipefail

REF="${1:-origin/main}"
APP_DIR="${APP_DIR:-/opt/affiliate-erp}"
SERVICE="${SERVICE:-affiliate-app}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100/login}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
LOCK_FILE="${LOCK_FILE:-/tmp/affiliate-erp-deploy.lock}"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# One deploy at a time: two overlapping builds would fight over .next.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another deploy is already running — exiting"
  exit 1
fi

cd "$APP_DIR"

PREVIOUS="$(git rev-parse HEAD)"

log "fetching origin"
git fetch --prune origin

log "checking out $REF"
git checkout --force "$REF"
TARGET="$(git rev-parse HEAD)"

build_and_restart() {
  log "install (frozen lockfile)"
  corepack pnpm install --frozen-lockfile --prefer-offline

  log "build (heap capped at 1 GB)"
  NODE_OPTIONS=--max-old-space-size=1024 corepack pnpm build

  log "restarting $SERVICE"
  sudo systemctl restart "$SERVICE"

  log "waiting for $HEALTH_URL"
  for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS -o /dev/null --max-time 3 "$HEALTH_URL"; then
      return 0
    fi
    sleep 2
  done

  log "health check did not pass"
  return 1
}

log "deploying ${TARGET:0:7} (currently ${PREVIOUS:0:7})"

if build_and_restart; then
  log "OK ${TARGET:0:7}"
  exit 0
fi

log "rolling back to ${PREVIOUS:0:7}"
git checkout --force "$PREVIOUS"

if build_and_restart; then
  log "rolled back to ${PREVIOUS:0:7} — the pushed commit failed its health check"
  exit 1
fi

log "ROLLBACK FAILED — manual intervention required"
exit 2
