#!/usr/bin/env bun
/**
 * Ingest DiscordChatExporter JSON exports into the searchable Message table.
 *
 * Usable as a CLI or as a library — `scripts/scrape-next.ts` calls ingestPath()
 * directly after an export so a scheduled sync is one process, not two.
 *
 *   bun run ingest                     # every export under ./exports
 *   bun run ingest exports/Wan         # one server's folder
 *   bun run ingest path/to/file.json   # one file
 *
 * The exports are large — the pixorama one is 460MB / 211k messages — so the
 * file is streamed and messages are parsed one object at a time. JSON.parse on
 * the whole file would blow up the heap.
 *
 * Re-running is safe: rows are keyed on the Discord message id and upserted.
 */

import { Database } from 'bun:sqlite'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { detectVersions, versionFromChannelName } from '../src/lib/wan-version'
import { detectPrompt } from '../src/lib/prompt-detect'
import { FTS_DDL, FTS_REBUILD } from '../src/lib/fts'

const DB_PATH = resolve(process.cwd(), 'prisma/prisma/dev.db')
const BATCH = 2_000

interface DceAttachment { id: string; url: string; fileName: string; fileSizeBytes: number }
interface DceMessage {
  id: string
  type: string
  timestamp: string
  content: string
  author: { id: string; name: string; nickname?: string | null; isBot?: boolean }
  attachments: DceAttachment[]
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|gif)$/i

/**
 * Stream the `messages` array out of a DCE export without holding the file in
 * memory. Walks the raw text tracking brace depth (string- and escape-aware)
 * and yields each complete top-level object.
 */
async function* streamMessages(path: string): AsyncGenerator<DceMessage> {
  const reader = Bun.file(path).stream().getReader()
  const decoder = new TextDecoder()

  let buf = ''
  /** Index in `buf` where scanning should resume. Chunks arrive mid-object, so
   *  the scan must continue where it stopped — restarting at 0 would re-count
   *  braces already counted and silently merge or drop messages. */
  let scan = 0
  let started = false
  let depth = 0
  let inStr = false
  let esc = false
  let objStart = -1

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    if (!started) {
      const key = buf.indexOf('"messages"')
      if (key === -1) {
        // Keep a short tail in case the key straddles the chunk boundary.
        if (buf.length > 16) buf = buf.slice(-16)
        scan = 0
        continue
      }
      const bracket = buf.indexOf('[', key)
      if (bracket === -1) continue
      started = true
      buf = buf.slice(bracket + 1)
      scan = 0
    }

    for (let i = scan; i < buf.length; i++) {
      const ch = buf[i]

      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') { inStr = true; continue }
      if (ch === '{') { if (depth === 0) objStart = i; depth++; continue }
      if (ch === '}') {
        depth--
        if (depth === 0 && objStart >= 0) {
          yield JSON.parse(buf.slice(objStart, i + 1)) as DceMessage
          buf = buf.slice(i + 1)
          objStart = -1
          i = -1 // rescan the trimmed buffer from the start
        }
        continue
      }
      // A closing bracket at depth 0 is the end of the messages array.
      if (ch === ']' && depth === 0) return
    }

    if (objStart === -1) {
      // Between objects: only whitespace and commas can be left, drop them.
      buf = ''
      scan = 0
    } else {
      scan = buf.length
    }
  }
}

/** Read the export's guild/channel header without parsing the message array. */
async function readHeader(path: string): Promise<{ guild: { id: string; name: string }; channel: { id: string; name: string } } | null> {
  const head = await Bun.file(path).slice(0, 8192).text()
  const cut = head.indexOf('"messages"')
  const json = (cut === -1 ? head : head.slice(0, cut)).replace(/,\s*$/, '') + '}'
  try {
    const parsed = JSON.parse(json)
    if (!parsed.guild || !parsed.channel) return null
    return parsed
  } catch {
    return null
  }
}

async function findExports(target: string): Promise<string[]> {
  const info = await stat(target).catch(() => null)
  if (!info) return []
  if (info.isFile()) return target.endsWith('.json') ? [target] : []

  const out: string[] = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const p = join(target, entry.name)
    if (entry.isDirectory()) out.push(...(await findExports(p)))
    else if (entry.name.endsWith('.json')) out.push(p)
  }
  return out
}

function cuid(): string {
  return 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
}

export interface IngestStats {
  files: number
  ingested: number
  prompts: number
  total: number
  byVersion: { version: string | null; count: number }[]
}

export async function ingestPath(targetPath = 'exports', quiet = false): Promise<IngestStats> {
  const log = (...a: unknown[]) => { if (!quiet) console.log(...a) }
  const target = resolve(process.cwd(), targetPath)
  const files = await findExports(target)
  if (files.length === 0) throw new Error(`No .json exports found under ${target}`)

  const db = new Database(DB_PATH)
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA synchronous = NORMAL')
  for (const ddl of FTS_DDL) db.run(ddl)

  // The triggers only index rows this run touches. If message_fts was dropped
  // externally (a raw `prisma db push`), every older Message would be missing
  // from search until someone happened to open /search and its own check
  // rebuilt it — and on the launchd path nobody does. Check it here too.
  {
    // message_fts is external-content, so COUNT(*) on it reads through to
    // Message and cannot see an empty index. Ask the shadow table instead.
    const total = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM Message').get()?.n ?? 0
    const indexRows = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM message_fts_data').get()?.n ?? 0
    if (total > 0 && indexRows < 3) {
      console.warn(`[ingest] the search index is empty (${total} messages) — rebuilding`)
      db.run(FTS_REBUILD)
    }
  }

  const findServer = db.query<{ id: string }, [string]>('SELECT id FROM Server WHERE discordId = ?')
  const findChannel = db.query<{ id: string }, [string]>('SELECT id FROM Channel WHERE discordId = ?')
  const insertServer = db.query('INSERT INTO Server (id, name, discordId, addedAt) VALUES (?, ?, ?, ?)')
  const insertChannel = db.query(
    'INSERT INTO Channel (id, name, discordId, serverId, enabled, scrapeEvery) VALUES (?, ?, ?, ?, 1, 7)',
  )

  const upsert = db.query(`
    INSERT INTO Message (
      discordId, channelId, authorId, authorName, authorNick, isBot,
      content, timestamp, attachments, attachCount, hasImage, hasVideo, ingestedAt,
      wanVersion, wanVersionSrc, wanVersions, wanTask,
      isPrompt, promptScore, promptText, negativePrompt
    ) VALUES (
      $discordId, $channelId, $authorId, $authorName, $authorNick, $isBot,
      $content, $timestamp, $attachments, $attachCount, $hasImage, $hasVideo, $ingestedAt,
      $wanVersion, $wanVersionSrc, $wanVersions, $wanTask,
      $isPrompt, $promptScore, $promptText, $negativePrompt
    )
    ON CONFLICT(discordId) DO UPDATE SET
      content = excluded.content,
      attachments = excluded.attachments,
      attachCount = excluded.attachCount,
      hasImage = excluded.hasImage,
      hasVideo = excluded.hasVideo,
      wanVersion = excluded.wanVersion,
      wanVersionSrc = excluded.wanVersionSrc,
      wanVersions = excluded.wanVersions,
      wanTask = excluded.wanTask,
      isPrompt = excluded.isPrompt,
      promptScore = excluded.promptScore,
      promptText = excluded.promptText,
      negativePrompt = excluded.negativePrompt
  `)

  let grandTotal = 0
  let grandPrompts = 0

  for (const file of files) {
    const header = await readHeader(file)
    if (!header) {
      console.warn(`  skip (unreadable header): ${file}`)
      continue
    }

    const { guild, channel } = header
    let serverId = findServer.get(guild.id)?.id
    if (!serverId) {
      serverId = cuid()
      insertServer.run(serverId, guild.name, guild.id, Date.now())
    }
    let channelId = findChannel.get(channel.id)?.id
    if (!channelId) {
      channelId = cuid()
      insertChannel.run(channelId, channel.name, channel.id, serverId)
    }

    const channelVersion = versionFromChannelName(channel.name)
    log(`\n▸ ${guild.name} / #${channel.name}${channelVersion ? `  (channel hints ${channelVersion})` : ''}`)

    let count = 0
    let prompts = 0
    let newestId = BigInt(0) // Discord ids are snowflakes: bigger is newer
    let batch: DceMessage[] = []

    const flush = db.transaction((rows: DceMessage[]) => {
      for (const m of rows) {
        try {
          const id = BigInt(m.id)
          if (id > newestId) newestId = id
        } catch { /* non-numeric id, ignore */ }
        const content = m.content ?? ''
        const atts = m.attachments ?? []
        const hasImage = atts.some((a) => IMAGE_EXT.test(a.fileName))
        const hasVideo = atts.some((a) => VIDEO_EXT.test(a.fileName))

        const ver = detectVersions(content, { channelName: channel.name })
        const prompt = detectPrompt(content, hasImage || hasVideo)
        if (prompt.isPrompt) prompts++

        upsert.run({
          $discordId: m.id,
          $channelId: channelId!,
          $authorId: m.author?.id ?? '',
          $authorName: m.author?.name ?? 'unknown',
          $authorNick: m.author?.nickname ?? null,
          $isBot: m.author?.isBot ? 1 : 0,
          $content: content,
          $timestamp: new Date(m.timestamp).getTime(),
          $attachments: atts.length
            ? JSON.stringify(atts.map((a) => ({ url: a.url, name: a.fileName, bytes: a.fileSizeBytes })))
            : null,
          $attachCount: atts.length,
          $hasImage: hasImage ? 1 : 0,
          $hasVideo: hasVideo ? 1 : 0,
          $ingestedAt: Date.now(),
          $wanVersion: ver.version,
          $wanVersionSrc: ver.source,
          $wanVersions: ver.all.length ? JSON.stringify(ver.all) : null,
          $wanTask: ver.task,
          $isPrompt: prompt.isPrompt ? 1 : 0,
          $promptScore: prompt.score,
          $promptText: prompt.promptText,
          $negativePrompt: prompt.negativePrompt,
        })
      }
    })

    for await (const msg of streamMessages(file)) {
      batch.push(msg)
      count++
      if (batch.length >= BATCH) {
        flush(batch)
        batch = []
        if (!quiet) process.stdout.write(`\r  ${count.toLocaleString()} messages…`)
      }
    }
    if (batch.length) flush(batch)

    if (newestId > BigInt(0)) {
      const prev = db
        .query<{ lastMessageId: string | null }, [string]>('SELECT lastMessageId FROM Channel WHERE id = ?')
        .get(channelId)?.lastMessageId
      // Never move the watermark backwards — a re-ingest of an older export
      // must not make the next sync re-download everything since then.
      if (!prev || BigInt(prev) < newestId) {
        db.query('UPDATE Channel SET lastMessageId = ? WHERE id = ?').run(newestId.toString(), channelId)
      }
    }

    grandTotal += count
    grandPrompts += prompts
    log(`\r  ${count.toLocaleString()} messages, ${prompts.toLocaleString()} look like prompts`)
  }

  const total = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM Message').get()!.n
  const byVersion = db
    .query<{ wanVersion: string | null; n: number }, []>(
      'SELECT wanVersion, COUNT(*) AS n FROM Message GROUP BY wanVersion ORDER BY n DESC',
    )
    .all()

  log(`\n─────────────────────────────`)
  log(`ingested this run : ${grandTotal.toLocaleString()}`)
  log(`rows in Message   : ${total.toLocaleString()}`)
  log('\nby detected Wan version:')
  for (const r of byVersion) log(`  ${(r.wanVersion ?? '(none)').padEnd(8)} ${r.n.toLocaleString()}`)

  db.close()

  return {
    files: files.length,
    ingested: grandTotal,
    prompts: grandPrompts,
    total,
    byVersion: byVersion.map((r) => ({ version: r.wanVersion, count: Number(r.n) })),
  }
}

if (import.meta.main) {
  ingestPath(process.argv[2] ?? 'exports').catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
