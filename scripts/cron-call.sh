#!/usr/bin/env bash
#
# Calls one of the app's /api/cron/* endpoints on the local app and logs the result.
#
# Why this exists: the app ships `vercel.json` cron entries, but a VPS has no Vercel. Without
# something on the box, "2 deals a day" only happens when a human runs curl — which is how the
# channel sat empty for a week while three products were already in the database.
#
# Auth: CRON_SECRET from .env.production (the app also accepts WORKER_API_TOKEN as a fallback).
# The secret is read on the box and never passed as an argument, so it stays out of `ps`.
#
# Usage: cron-call.sh <health|reconcile|deal-poster|shopee-products|shopee-conversions|shopee-validated>
set -euo pipefail

endpoint="${1:?usage: cron-call.sh <health|reconcile|deal-poster|shopee-products|shopee-conversions|shopee-validated>}"
APP_DIR="${APP_DIR:-/opt/affiliate-erp}"
PORT="${APP_PORT:-3100}"
ENV_FILE="$APP_DIR/.env.production"

case "$endpoint" in
  health | reconcile | deal-poster) path="cron/$endpoint" ;;
  shopee-products) path="cron/shopee/products" ;;
  shopee-conversions) path="cron/shopee/conversions" ;;
  shopee-validated) path="cron/shopee/validated" ;;
  *)
    echo "unknown endpoint: $endpoint" >&2
    exit 2
    ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE (set APP_DIR to the checkout)" >&2
  exit 1
fi

read_env() {
  # Last wins, quotes stripped, no sourcing of the whole file.
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

secret="$(read_env CRON_SECRET)"
[ -n "$secret" ] || secret="$(read_env WORKER_API_TOKEN)"
if [ -n "$secret" ]; then
  auth=(-H "Authorization: Bearer $secret")
else
  auth=()
  echo "warn: no CRON_SECRET/WORKER_API_TOKEN in $ENV_FILE — calling without auth" >&2
fi

out="$(mktemp)"
code="$(curl -sS -o "$out" -w '%{http_code}' -X POST "${auth[@]}" "http://127.0.0.1:$PORT/api/$path" || echo 000)"
body="$(head -c 400 "$out" | tr -d '\n')"
rm -f "$out"

printf '%s %-18s http=%s %s\n' "$(date -u +%FT%TZ)" "$endpoint" "$code" "$body"

# Non-200 is an error for cron's exit status, so failures show up in the log's exit code.
[ "$code" = "200" ] || exit 1
