# Discordbase

Local Discord Knowledge Base Scraper — archives Discord channels via Docker on a schedule. All data stays on your machine.

## Stack

- **Runtime**: Bun
- **Framework**: Next.js 16 (App Router) + tRPC
- **Database**: Prisma + SQLite
- **Scraper**: `tyrrrz/discordchatexporter:stable` (Docker)
- **UI**: shadcn/ui + Tailwind, 8-bit retro theme

## Setup

```bash
# Install dependencies
bun install

# Init database
bunx prisma db push

# Start dev server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Prerequisites**: Docker Desktop must be running.

## Usage

1. **Settings** — paste your Discord user token (DevTools → Network → any `api/v*` request → `Authorization` header)
2. **Servers** — add a server (right-click server icon in Discord → Copy Server ID) and its channels
3. **SCAN** — click `▶ SCAN` on a channel to archive it now

## ⚠️ Rate Limit Rules — Read Before Testing

Discord will ban your account if you hammer their API. These rules are hard constraints:

- **24-hour cooldown per channel** — the UI enforces this, do not bypass it
- **Never scan the same channel twice in a day** — not even for testing
- **When testing, rotate channels** — use a different server/channel each time, not the same one repeatedly
- **One scan at a time** — sequential only, no parallel Docker containers for the same account
- **If you are writing code that triggers scans** — always target a different channel than the last test run

The 24h cooldown badge in the UI (`⏸ SCAN`, amber `Xh ago`) exists to protect your Discord account. Respect it.

## Architecture

```text
src/
  app/
    page.tsx          # Dashboard — live stats, recent jobs
    servers/page.tsx  # Server + channel management, SCAN buttons
    settings/page.tsx # Discord token, export format, output dir
  lib/
    docker.ts         # Only file that spawns Docker processes
    trpc.ts           # tRPC client singleton
  server/api/routers/
    job.ts            # triggerScrape — full Docker export implementation
    server.ts         # CRUD for servers
    channel.ts        # CRUD + toggle/interval for channels
    config.ts         # AppConfig singleton (token, format, outputDir)
    stats.ts          # Dashboard stats + real Docker status check
```

**Rules:**
- All Docker interaction goes through the docker module only — `src/lib/docker.ts`
  is the `server-only` facade for app code, `src/lib/docker-core.ts` holds the
  implementation so `scripts/` can reuse it outside the Next runtime
- No Discord SDK — only DCE in Docker touches Discord
- Token stored in SQLite, never in `.env`
- Dark theme only

## Exports

Output lands in `./exports/<serverName>/<channelName>/` as JSON (or chosen format).

## Search

Exports are just files until they are ingested. Two steps:

```bash
bun run ingest                # everything under ./exports
bun run ingest exports/Wan    # one server
```

Then open [/search](http://localhost:3000/search). Full-text search runs on a
SQLite FTS5 index (`message_fts`) over the `Message` table, ranked with bm25.

Query syntax: bare words are ANDed, `"exact phrase"` for phrases, `prefix*` for
wildcards, and `AND` / `OR` / `NOT` for booleans. Malformed input is sanitised
rather than thrown, so the box never 500s.

Filters: server, channel, author, Wan version, attribution confidence,
prompts-only, has-media, exclude-bots, and sort by relevance / date / how
prompt-like a message is.

### Scheduled syncs

A launchd agent runs `bun run scrape:next` every two hours: one channel per
firing, most-overdue first, still bound by the 24h cooldown. Install and control
it per `scripts/scheduler.md`; results land in the SYNC LOG tab.

Syncs are incremental. Each ingest records the newest message id on
`Channel.lastMessageId`, and the next export passes it to DCE as `--after`, so a
repeat sync pulls only what arrived since. Ingest upserts on Discord message id,
so overlapping exports update rows instead of duplicating them.

### ⚠️ `prisma db push` drops the search index

Prisma does not model virtual tables, so it drops `message_fts` — and leaves its
triggers behind, which then abort the next push with *no such table*. Use:

```bash
bun run db:push   # drops the index and triggers → pushes → rebuilds the index
```

Never call `prisma db push` directly. The index is derived from `Message`, so
nothing is lost; `bun run fts:rebuild` regenerates it at any time, and the search
router repairs an out-of-sync index on first query.

### Wan version attribution

The point of the archive is telling a 3.0 prompt from a 2.7 prompt, so every
message gets a `wanVersion` plus the source it was derived from:

| source | means | trust |
|--------|-------|-------|
| `model_id` | a real identifier — `Wan2.2-I2V-A14B` | highest |
| `explicit` | the word Wan bound to a version — "Wan 3.0", "wan27" | high |
| `contextual` | a bare "2.7" in a message already about Wan | medium, shown with a `?` |
| `channel` | the channel name | off by default |

**Channel names are not labels.** Sampling the official server found `#wan26`
discussing 2.7 more than 2.6, so `useChannelFallback` is off — otherwise every
quiet message in a versioned channel would falsely claim that version. Use the
CONFIDENCE filter to drop `contextual` guesses when you need a clean set.

Detection lives in `src/lib/wan-version.ts`; prompt scoring in
`src/lib/prompt-detect.ts`. Both are pure functions — tune the regexes, re-run
`bun run ingest` (it upserts on message id) and the labels update in place.

## Sprint Plan

| Sprint | Status | Scope |
|--------|--------|-------|
| 0 | ✅ | Scaffold — Next.js, tRPC, Prisma, 8-bit theme |
| 1 | ✅ | Functional UI — sidebar, dashboard, servers, settings, SCAN button, 24h cooldown, scanning overlay |
| 2 | 🔜 | SSE progress streaming — live DCE output in browser |
| — | ✅ | Search — FTS5 index, ingest script, Wan version attribution |
| 3 | ✅ | Scheduler — launchd agent, one due channel every 2h, incremental |
| 4 | ✅ | Job history — SYNC LOG tab with duration, size, throughput, errors |
| 5 | 🔜 | Polish |
