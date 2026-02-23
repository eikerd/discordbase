# Discordbase

Local Discord Knowledge Base Scraper — archives Discord channels via Docker on a schedule. All data stays on your machine.

## Stack

- **Runtime**: Bun
- **Framework**: Next.js 14 (App Router) + tRPC
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

```
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
- All Docker interaction goes through `src/lib/docker.ts` only
- No Discord SDK — only DCE in Docker touches Discord
- Token stored in SQLite, never in `.env`
- Dark theme only

## Exports

Output lands in `./exports/<serverName>/<channelName>/` as JSON (or chosen format).

## Sprint Plan

| Sprint | Status | Scope |
|--------|--------|-------|
| 0 | ✅ | Scaffold — Next.js, tRPC, Prisma, 8-bit theme |
| 1 | ✅ | Functional UI — sidebar, dashboard, servers, settings, SCAN button, 24h cooldown, scanning overlay |
| 2 | 🔜 | SSE progress streaming — live DCE output in browser |
| 3 | 🔜 | Scheduler — node-cron, auto-scrape due channels |
| 4 | 🔜 | Job history page |
| 5 | 🔜 | Polish |
