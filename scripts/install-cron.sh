#!/usr/bin/env bash
#
# Installs the scheduling that makes the app self-driving on a VPS.
#
# Needs root (writes /etc/cron.d) and is idempotent: re-running rewrites the same file, so a
# checkout that moves only needs this script run again.
#
#   sudo bash scripts/install-cron.sh
#
# Replaces the "human runs curl twice a day" step — the reason /products had products while the
# channel showed only "Channel created".
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALL="$APP_DIR/scripts/cron-call.sh"
LOG=/var/log/affiliate-cron.log
TARGET=/etc/cron.d/affiliate-erp

if [ ! -x "$CALL" ]; then
  echo "missing or not executable: $CALL" >&2
  exit 1
fi

if [ ! -f "$APP_DIR/.env.production" ]; then
  echo "warning: $APP_DIR/.env.production not found — cron will run unauthenticated and fail" >&2
fi

cat > "$TARGET" <<EOF
# Managed by $APP_DIR/scripts/install-cron.sh — edit the script, not this file.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
APP_DIR=$APP_DIR

# Worker watchdog + queue hygiene.
*/10 * * * * root APP_DIR=$APP_DIR $CALL health >> $LOG 2>&1
*/30 * * * * root APP_DIR=$APP_DIR $CALL reconcile >> $LOG 2>&1

# Shopee sync (skips by itself while credentials are pending).
0 */6 * * * root APP_DIR=$APP_DIR $CALL shopee-products >> $LOG 2>&1
0 * * * * root APP_DIR=$APP_DIR $CALL shopee-conversions >> $LOG 2>&1
0 18 * * * root APP_DIR=$APP_DIR $CALL shopee-validated >> $LOG 2>&1

# Keyword product discovery: fills the pool with items the sourcing groups actually discuss.
# Separate from the 6-hourly offer sync, which imports the default list with no niche.
0 20 * * * root APP_DIR=$APP_DIR $CALL shopee-discover >> $LOG 2>&1

# The deal channel: 04:30 and 13:30 UTC = 11:30 and 20:30 Vietnam.
30 4,13 * * * root APP_DIR=$APP_DIR $CALL deal-poster >> $LOG 2>&1
EOF

chmod 644 "$TARGET"
touch "$LOG"
chmod 640 "$LOG"

if ! command -v cron >/dev/null 2>&1 && ! systemctl is-active --quiet cron; then
  echo "note: cron service not active — starting it" >&2
  systemctl enable --now cron 2>/dev/null || systemctl enable --now crond 2>/dev/null || true
fi

echo "installed $TARGET"
echo "log: $LOG"
echo
cat "$TARGET"
