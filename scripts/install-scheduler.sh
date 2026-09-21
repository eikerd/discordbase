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

# Resolve the override first: the whole point of BUN is to work when bun is not
# on PATH, so testing PATH before honouring it defeated the documented escape.
bun="${BUN:-$(command -v bun || true)}"
if [ -z "$bun" ]; then
  echo "bun is not on PATH. Install it, or set BUN=/path/to/bun and re-run." >&2
  exit 1
fi
if [ ! -x "$bun" ]; then
  echo "Not executable: $bun" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$repo/logs"
# A path may contain the sed delimiter, and an "&" is special in both sed and
# awk REPLACEMENT text (it means "the matched string"), so neither gsub nor sed
# can be handed a raw path. Replace literally with index/substr instead.
BUN_PATH="$bun" WORKDIR="$repo" HOMEDIR="$HOME" awk '
  function lit(s, needle, rep,   out, i) {
    out = ""
    while ((i = index(s, needle)) > 0) {
      out = out substr(s, 1, i - 1) rep
      s = substr(s, i + length(needle))
    }
    return out s
  }
  { line = lit($0, "__BUN__", ENVIRON["BUN_PATH"])
    line = lit(line, "__WORKDIR__", ENVIRON["WORKDIR"])
    line = lit(line, "__HOME__", ENVIRON["HOMEDIR"])
    print line }
' "$template" > "$target"

# bootout first: launchd caches the plist at load, so a re-install of an
# already-loaded label would otherwise keep running the old one.
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$target"

echo "Installed $label"
echo "  bun:     $bun"
echo "  workdir: $repo"
echo "  log:     $repo/logs/scheduler.log"
echo "Check it with: launchctl print gui/$(id -u)/$label | head"
