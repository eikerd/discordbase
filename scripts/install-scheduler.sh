#!/usr/bin/env bash
# Generates the launchd agent for THIS checkout and loads it.
#
# The plist is a template because launchd needs absolute paths, and the ones
# that are right here are wrong on any other machine. Copying the old checked-in
# plist registered a job pointing at a directory that did not exist, and launchd
# reported nothing.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$repo/scripts/com.discordbase.scrape.plist.template"
target="$HOME/Library/LaunchAgents/com.discordbase.scrape.plist"
label="com.discordbase.scrape"

bun="$(command -v bun || true)"
if [ -z "$bun" ]; then
  echo "bun is not on PATH. Install it, or set BUN=/path/to/bun and re-run." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$repo/logs"
sed -e "s|__BUN__|${BUN:-$bun}|g" \
    -e "s|__WORKDIR__|$repo|g" \
    -e "s|__HOME__|$HOME|g" \
    "$template" > "$target"

# bootout first: launchd caches the plist at load, so a re-install of an
# already-loaded label would otherwise keep running the old one.
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$target"

echo "Installed $label"
echo "  bun:     ${BUN:-$bun}"
echo "  workdir: $repo"
echo "  log:     $repo/logs/scheduler.log"
echo "Check it with: launchctl print gui/$(id -u)/$label | head"
