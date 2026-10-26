#!/bin/sh
# WorldView power watcher — runs every 2 minutes (npm run power:install).
#   Plugged in  → keep the WorldView server running (live data + instant alerts).
#   On battery  → stop it, unless the app is open in a browser tab or a scheduled
#                 job is using it. The battery sentinel covers alerts meanwhile.
# Open the app on battery with `npm run app` (starts the server; it stops again
# ~10 minutes after the last tab closes).
L=com.worldview.server
T="gui/$(id -u)"
P="$HOME/Library/LaunchAgents/$L.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SEEN="$DIR/.data/last-viewer"
[ -f "$P" ] || exit 0
running() { launchctl print "$T/$L" >/dev/null 2>&1; }

if pmset -g ps | head -1 | grep -q "AC Power"; then
  running || launchctl bootstrap "$T" "$P"
  exit 0
fi

running || exit 0
v=$(curl -s --max-time 3 http://127.0.0.1:3000/api/viewers | sed -n 's/.*"viewers":\([0-9]*\).*/\1/p')
if [ "${v:-0}" -gt 0 ]; then
  touch "$SEEN"
  exit 0
fi
pgrep -f "morning-briefing.ts|market-close.ts" >/dev/null && exit 0
# Grace period: someone was viewing (or ran `npm run app`) in the last 10 minutes.
[ -f "$SEEN" ] && [ -n "$(find "$SEEN" -mmin -10 2>/dev/null)" ] && exit 0
launchctl bootout "$T/$L" 2>/dev/null
echo "$(date -u +%FT%TZ) on battery, no viewers — stopped WorldView server"
