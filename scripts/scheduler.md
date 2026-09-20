# Scheduled scraping

`scripts/scrape-next.ts` scrapes **one** channel per run — the most overdue
enabled channel that is past its 24h cooldown — then ingests it and records the
result as a `ScrapeJob`, visible in the SYNC LOG tab.

## Install the launchd agent

```bash
cp scripts/com.discordbase.scrape.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.discordbase.scrape.plist
```

## Control it

```bash
launchctl print gui/$(id -u)/com.discordbase.scrape   # status, last exit code
launchctl kickstart -p gui/$(id -u)/com.discordbase.scrape   # run one now
launchctl bootout gui/$(id -u)/com.discordbase.scrape        # stop and remove
tail -f logs/scheduler.log
```

Change the cadence by editing `StartInterval` (seconds), then `bootout` and
`bootstrap` again — launchd caches the plist at load time.

## Why it is safe to leave running

- one channel per firing, never a batch
- refuses to start if a previous job is still `running`
- the 24h per-channel cooldown is enforced in the script, not just the UI
- resumes from `Channel.lastMessageId` via DCE `--after`, so a repeat sync of a
  quiet channel downloads almost nothing
- if Docker is not running, or nothing is due, it logs a line and exits 0

At two-hour firings and a 24h cooldown, a channel can be touched at most once a
day no matter how often launchd wakes it.

## Incremental vs full

The first sync of a channel is a full export. Every later sync passes
`--after <lastMessageId>`, so only messages newer than the watermark come down.
The ingest upserts on Discord message id, so re-ingesting an overlapping export
updates rows rather than duplicating them, and the watermark never moves
backwards.
