#!/usr/bin/env bun
/**
 * Scrape the single most-overdue channel, then ingest it. One channel per run.
 *
 * Meant to be fired by launchd every couple of hours (see scripts/scheduler.md).
 * Deliberately conservative, because the account is the thing at risk:
 *   - exactly one channel per invocation, never a batch
 *   - refuses to run if another job is still marked running
 *   - honours the 24h per-channel cooldown from the README
 *   - resumes from the last ingested message id, so a resync pulls only new
 *     messages rather than re-downloading the whole channel
 *
 * Exit codes are all 0 for "nothing to do" cases — launchd should not treat a
 * quiet run as a failure.
 */

import { Database } from 'bun:sqlite'
import { resolve } from 'node:path'
import { runChannelExport, ensureImage, checkDockerAvailable } from '../src/lib/docker-core'
import { ingestPath } from './ingest'

const DB_PATH = resolve(process.cwd(), 'prisma/prisma/dev.db')
const COOLDOWN_MS = 24 * 60 * 60 * 1000

interface DueChannel {
  id: string
  name: string
  discordId: string
  lastMessageId: string | null
  serverName: string
}

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}
function log(...args: unknown[]) {
  console.log(`[${stamp()}]`, ...args)
}

function cuid(): string {
  return 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
}

/** Past this, a job still marked running is wreckage from a crashed process:
 *  docker-core caps an export at 12h, so nothing legitimate reaches 13. */
const STALE_JOB_MS = 13 * 60 * 60_000

async function main() {
  const db = new Database(DB_PATH)
  db.run('PRAGMA journal_mode = WAL')

  // A job that died without reaching its catch — OOM, kill -9, a crash outside
  // the try — leaves status='running' forever. Without this the guard below
  // then skips every tick from here on and the scheduled sync stops for good,
  // silently, because the skip exits 0 so launchd sees nothing wrong.
  // An export cannot legitimately outlive docker-core's own 12h ceiling, so
  // anything older than that plus an hour's grace is wreckage, not work.
  const staleBefore = new Date(Date.now() - STALE_JOB_MS).toISOString()
  const reclaimed = db.run(
    `UPDATE ScrapeJob
        SET status = 'failed',
            finishedAt = CURRENT_TIMESTAMP,
            errorLog = COALESCE(errorLog, '') ||
              'Reclaimed by the scheduler: still marked running after ' ||
              ? || 'h with no process to finish it.'
      WHERE status = 'running' AND COALESCE(startedAt, createdAt) < ?`,
    [String(STALE_JOB_MS / 3_600_000), staleBefore],
  )
  if (reclaimed.changes > 0) {
    log(`reclaimed ${reclaimed.changes} stale running job(s) — a previous run died without finishing`)
  }

  // Another run still in flight? Bail rather than stack Docker containers.
  const running = db
    .query<{ id: string; channelId: string }, []>("SELECT id, channelId FROM ScrapeJob WHERE status = 'running' LIMIT 1")
    .get()
  if (running) {
    log(`a job is already running (${running.id}) — skipping this tick`)
    return
  }

  const cutoff = Date.now() - COOLDOWN_MS
  const channel = db
    .query<DueChannel, [number]>(`
      SELECT ch.id, ch.name, ch.discordId, ch.lastMessageId, s.name AS serverName
      FROM Channel ch
      JOIN Server s ON s.id = ch.serverId
      WHERE ch.enabled = 1
        AND (ch.lastScraped IS NULL OR ch.lastScraped < ?)
      ORDER BY ch.lastScraped IS NOT NULL, ch.lastScraped ASC
      LIMIT 1
    `)
    .get(cutoff)

  if (!channel) {
    log('nothing is due — every enabled channel is inside its 24h cooldown')
    return
  }

  const config = db
    .query<{ discordToken: string; exportFormat: string; outputDir: string }, []>(
      "SELECT discordToken, exportFormat, outputDir FROM AppConfig WHERE id = 'singleton'",
    )
    .get()
  if (!config?.discordToken) {
    log('no Discord token configured — set one in Settings')
    return
  }

  if (!(await checkDockerAvailable())) {
    log('Docker is not running — skipping this tick')
    return
  }

  const mode = channel.lastMessageId ? `incremental from ${channel.lastMessageId}` : 'full'
  log(`▶ ${channel.serverName} / #${channel.name} (${mode})`)

  const jobId = cuid()
  const startedAt = Date.now()
  db.query(
    `INSERT INTO ScrapeJob (id, channelId, status, startedAt, createdAt, trigger)
     VALUES (?, ?, 'running', ?, ?, 'scheduled')`,
  ).run(jobId, channel.id, startedAt, startedAt)

  const fail = (stage: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    db.query(
      `UPDATE ScrapeJob SET status = 'failed', finishedAt = ?, errorLog = ?, failedStage = ? WHERE id = ?`,
    ).run(Date.now(), message, stage, jobId)
    log(`✗ ${stage} failed: ${message}`)
  }

  let exported
  try {
    await ensureImage()
    exported = await runChannelExport({
      token: config.discordToken,
      channelDiscordId: channel.discordId,
      serverName: channel.serverName,
      channelName: channel.name,
      format: config.exportFormat,
      outputDir: config.outputDir,
      after: channel.lastMessageId,
    })
  } catch (err) {
    fail('export', err)
    return
  }

  // The cooldown starts at the export, not the ingest — a failed ingest is a
  // local problem and must not license another download of the same channel.
  db.query('UPDATE Channel SET lastScraped = ? WHERE id = ?').run(Date.now(), channel.id)

  let stats
  try {
    stats = await ingestPath(exported.outputPath, true)
  } catch (err) {
    db.query(
      `UPDATE ScrapeJob SET status = 'partial', finishedAt = ?, messageCount = ?, outputPath = ?, exportBytes = ?, errorLog = ?, failedStage = 'ingest' WHERE id = ?`,
    ).run(
      Date.now(),
      exported.messageCount,
      exported.outputPath,
      exported.bytes,
      err instanceof Error ? err.message : String(err),
      jobId,
    )
    log(`✗ ingest failed, export kept at ${exported.outputPath}`)
    return
  }

  const finishedAt = Date.now()
  db.query(
    `UPDATE ScrapeJob
     SET status = 'done', finishedAt = ?, messageCount = ?, outputPath = ?,
         exportBytes = ?, ingestedCount = ?, promptCount = ?
     WHERE id = ?`,
  ).run(
    finishedAt,
    exported.messageCount,
    exported.outputPath,
    exported.bytes,
    stats.ingested,
    stats.prompts,
    jobId,
  )

  const secs = ((finishedAt - startedAt) / 1000).toFixed(1)
  log(
    `✓ ${channel.serverName} / #${channel.name} — ${exported.messageCount.toLocaleString()} exported, ` +
      `${stats.ingested.toLocaleString()} ingested, ${stats.prompts.toLocaleString()} prompts, ` +
      `${(exported.bytes / 1e6).toFixed(1)} MB in ${secs}s`,
  )
  db.close()
}

main().catch((err) => {
  console.error(`[${stamp()}] unhandled:`, err)
  process.exit(1)
})
