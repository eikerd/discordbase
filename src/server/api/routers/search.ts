import { router, publicProcedure } from '../trpc'
import { z } from 'zod'
import { db } from '@/lib/db'
import { FTS_DDL, FTS_REBUILD, toFtsQuery, ONE_RUNNING_JOB_DDL } from '@/lib/fts'
import { KNOWN_VERSIONS, VERSION_SOURCES } from '@/lib/wan-version'

/**
 * Search over ingested messages.
 *
 * Two paths: with a query string we go through the FTS5 index and rank by
 * bm25; without one we just filter and sort the Message table. Filters are
 * identical either way, so they are built once.
 */

let ftsReadyUntil = 0
/** How long a successful check is trusted before it is made again. Long enough
 *  that a busy search page does not re-count on every keystroke, short enough
 *  that a table dropped underneath a running server heals on its own — the old
 *  once-per-process flag never re-checked, so it did not. */
const FTS_RECHECK_MS = 60_000

/**
 * `prisma db push` drops message_fts every time it runs, and CREATE IF NOT
 * EXISTS would then leave an empty index that silently returns no results. So
 * compare the row counts and rebuild when they disagree.
 */
async function ensureFts() {
  if (Date.now() < ftsReadyUntil) return
  for (const ddl of FTS_DDL) await db.$executeRawUnsafe(ddl)
  await db.$executeRawUnsafe(ONE_RUNNING_JOB_DDL)

  const [{ n: messages }] = await db.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM Message')
  // NOT `COUNT(*) FROM message_fts`: this is an external-content table, so that
  // reads straight through to Message and reports the full count even when the
  // inverted index is empty — it can never detect the failure it was guarding
  // against. ('integrity-check' passes on an emptied index too.) The shadow
  // table is the index itself: a healthy one here has thousands of rows, an
  // emptied one has two.
  const [{ n: indexRows }] = await db.$queryRawUnsafe<{ n: bigint }[]>(
    'SELECT COUNT(*) AS n FROM message_fts_data',
  )
  if (Number(messages) > 0 && Number(indexRows) < 3) {
    console.warn(`[search] the search index is empty (${messages} messages) — rebuilding`)
    await db.$executeRawUnsafe(FTS_REBUILD)
  }

  ftsReadyUntil = Date.now() + FTS_RECHECK_MS
}

const searchInput = z.object({
  q: z.string().max(500).default(''),
  serverId: z.string().optional(),
  channelId: z.string().optional(),
  author: z.string().optional(),
  /** A version string, or "none" for messages we could not attribute. */
  version: z.string().optional(),
  /** Drop attributions weaker than this. Defaults to trusting everything. */
  minSource: z.enum(VERSION_SOURCES).optional(),
  promptsOnly: z.boolean().default(false),
  withMedia: z.boolean().default(false),
  excludeBots: z.boolean().default(false),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(['relevance', 'newest', 'oldest', 'promptScore']).default('relevance'),
  limit: z.number().min(1).max(100).default(25),
  offset: z.number().min(0).default(0),
})

type SearchInput = z.infer<typeof searchInput>

/** Shared WHERE fragments. Returns SQL plus positional params. */
function buildFilters(input: SearchInput) {
  const where: string[] = []
  const params: unknown[] = []

  if (input.serverId) { where.push('s.id = ?'); params.push(input.serverId) }
  if (input.channelId) { where.push('c.id = ?'); params.push(input.channelId) }
  // Results display authorNick || authorName, so a search for the name someone
  // can actually see has to match either one.
  if (input.author) {
    where.push('(m.authorName LIKE ? OR m.authorNick LIKE ?)')
    params.push(`%${input.author}%`, `%${input.author}%`)
  }

  if (input.version === 'none') {
    where.push('m.wanVersion IS NULL')
  } else if (input.version) {
    where.push('m.wanVersion = ?')
    params.push(input.version)
  }

  if (input.minSource) {
    // VERSION_SOURCES is ordered strongest → weakest.
    const allowed = VERSION_SOURCES.slice(0, VERSION_SOURCES.indexOf(input.minSource) + 1)
    where.push(`m.wanVersionSrc IN (${allowed.map(() => '?').join(',')})`)
    params.push(...allowed)
  }

  if (input.promptsOnly) where.push('m.isPrompt = 1')
  if (input.withMedia) where.push('m.attachCount > 0')
  if (input.excludeBots) where.push('m.isBot = 0')

  if (input.from) { where.push('m.timestamp >= ?'); params.push(new Date(input.from).getTime()) }
  if (input.to) { where.push('m.timestamp <= ?'); params.push(new Date(input.to).getTime() + 86_400_000) }

  return { sql: where.length ? ` AND ${where.join(' AND ')}` : '', params }
}

const ORDER: Record<SearchInput['sort'], string> = {
  relevance: 'rank ASC',
  newest: 'm.timestamp DESC',
  oldest: 'm.timestamp ASC',
  promptScore: 'm.promptScore DESC, m.timestamp DESC',
}

const SELECT_COLS = `
  m.seq, m.discordId, m.content, m.authorName, m.authorNick, m.isBot,
  m.timestamp, m.attachments, m.attachCount, m.hasImage, m.hasVideo,
  m.wanVersion, m.wanVersionSrc, m.wanVersions, m.wanTask,
  m.isPrompt, m.promptScore, m.promptText, m.negativePrompt,
  c.name AS channelName, c.discordId AS channelDiscordId,
  s.name AS serverName, s.discordId AS serverDiscordId
`

export interface SearchHit {
  seq: number
  discordId: string
  content: string
  snippet: string
  authorName: string
  authorNick: string | null
  isBot: boolean
  timestamp: number
  attachments: string | null
  attachCount: number
  hasImage: boolean
  hasVideo: boolean
  wanVersion: string | null
  wanVersionSrc: string | null
  wanVersions: string | null
  wanTask: string | null
  isPrompt: boolean
  promptScore: number
  promptText: string | null
  negativePrompt: string | null
  channelName: string
  channelDiscordId: string
  serverName: string
  serverDiscordId: string
}

export const searchRouter = router({
  /** Dropdown data for the filter bar. */
  filters: publicProcedure.query(async () => {
    // The filter bar is the page's scaffolding; if the index is unavailable the
    // dropdowns should still populate rather than failing the whole page.
    try {
      await ensureFts()
    } catch (err) {
      console.error('[search] filters: could not prepare the index —', err)
    }

    const servers = await db.server.findMany({
      orderBy: { name: 'asc' },
      include: { channels: { orderBy: { name: 'asc' }, select: { id: true, name: true } } },
    })

    const versionRows = await db.$queryRawUnsafe<{ wanVersion: string | null; n: bigint }[]>(
      'SELECT wanVersion, COUNT(*) AS n FROM Message GROUP BY wanVersion',
    )
    const versions = versionRows
      .map((r) => ({ version: r.wanVersion, count: Number(r.n) }))
      .sort((a, b) => {
        if (a.version === null) return 1
        if (b.version === null) return -1
        return b.version.localeCompare(a.version)
      })

    const totals = await db.$queryRawUnsafe<{ total: bigint; prompts: bigint }[]>(
      'SELECT COUNT(*) AS total, SUM(isPrompt) AS prompts FROM Message',
    )

    return {
      servers,
      versions,
      knownVersions: KNOWN_VERSIONS,
      total: Number(totals[0]?.total ?? 0),
      prompts: Number(totals[0]?.prompts ?? 0),
    }
  }),

  query: publicProcedure.input(searchInput).query(async ({ input }) => {
    await ensureFts()

    const filters = buildFilters(input)
    const typed = input.q.trim()
    const fts = typed ? toFtsQuery(input.q) : null

    // Something was typed but nothing survived normalisation — "((((", say.
    // Falling through to the unfiltered path would answer with the entire
    // archive, which reads as though the search box were ignored.
    if (typed && !fts) {
      return { hits: [], total: 0, facets: [], ftsQuery: null, error: null as string | null }
    }

    // Relevance only means something with a text query.
    const sort = input.sort === 'relevance' && !fts ? 'newest' : input.sort
    const orderBy = ORDER[sort]

    const base = fts
      ? `FROM message_fts f
         JOIN Message m ON m.seq = f.rowid
         JOIN Channel c ON c.id = m.channelId
         JOIN Server  s ON s.id = c.serverId
         WHERE message_fts MATCH ?${filters.sql}`
      : `FROM Message m
         JOIN Channel c ON c.id = m.channelId
         JOIN Server  s ON s.id = c.serverId
         WHERE 1 = 1${filters.sql}`

    const baseParams = fts ? [fts, ...filters.params] : filters.params

    // CAST to REAL matters: a bare `0` comes back from the SQLite driver as a
    // BigInt, which then fails to serialise over tRPC.
    const rankCol = fts ? 'bm25(message_fts, 10.0, 1.0) AS rank' : 'CAST(0 AS REAL) AS rank'
    const snippetCol = fts
      ? `snippet(message_fts, 0, '⟦', '⟧', ' … ', 40) AS snippet`
      : `substr(m.content, 1, 320) AS snippet`

    try {
      const rows = await db.$queryRawUnsafe<(SearchHit & { rank: number })[]>(
        `SELECT ${SELECT_COLS}, ${snippetCol}, ${rankCol} ${base} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        ...baseParams,
        input.limit,
        input.offset,
      )

      const countRows = await db.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n ${base}`,
        ...baseParams,
      )

      // Version breakdown for exactly this result set — this is what makes
      // "how do 3.0 prompts differ from 2.7" answerable in one query.
      const facetRows = await db.$queryRawUnsafe<{ wanVersion: string | null; n: bigint }[]>(
        `SELECT m.wanVersion, COUNT(*) AS n ${base} GROUP BY m.wanVersion ORDER BY n DESC`,
        ...baseParams,
      )

      return {
        hits: rows.map((r) => ({
          ...r,
          isBot: Boolean(r.isBot),
          isPrompt: Boolean(r.isPrompt),
          hasImage: Boolean(r.hasImage),
          hasVideo: Boolean(r.hasVideo),
        })),
        total: Number(countRows[0]?.n ?? 0),
        facets: facetRows.map((r) => ({ version: r.wanVersion, count: Number(r.n) })),
        ftsQuery: fts,
        error: null as string | null,
      }
    } catch (err) {
      // A malformed MATCH expression should show as an empty result with an
      // explanation, not a 500 that blanks the page.
      const message = err instanceof Error ? err.message : String(err)
      return {
        hits: [],
        total: 0,
        facets: [],
        ftsQuery: fts,
        error: /fts5|syntax/i.test(message) ? 'Could not parse that query.' : message,
      }
    }
  }),
})
