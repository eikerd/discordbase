'use client'

import { useState, useMemo, useEffect } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { trpc } from '@/lib/trpc'

// ─── Theme tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#0f0f23',
  panel: '#1a1a32',
  border: '#2a2a4a',
  fg: '#e8e8e8',
  dim: '#a8a8c8',
  faint: '#4a4a6a',
  green: '#00ff41',
  amber: '#ffb000',
  blue: '#29adff',
  red: '#ff004d',
} as const

/** Colour per Wan version so a result list is scannable at a glance. */
const VERSION_COLOR: Record<string, string> = {
  '3.0': '#ff004d',
  '2.7': '#ffb000',
  '2.6': '#00ff41',
  '2.5': '#29adff',
  '2.2': '#b57bff',
  '2.1': '#7a7a9a',
}

/** How much to trust a version label. */
const SOURCE_LABEL: Record<string, string> = {
  model_id: 'model id',
  explicit: 'named',
  contextual: 'inferred',
  channel: 'channel',
}

type Attachment = { url: string; name: string; bytes: number }

// ─── Small pieces ────────────────────────────────────────────────────────────

function VersionTag({ version, source }: { version: string | null; source: string | null }) {
  if (!version) {
    return <span className="text-[9px] px-1.5 py-0.5" style={{ color: C.faint, border: `1px solid ${C.border}` }}>NO VERSION</span>
  }
  const color = VERSION_COLOR[version] ?? C.dim
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 whitespace-nowrap"
      style={{ color: C.bg, background: color }}
      title={source ? `detected from ${SOURCE_LABEL[source] ?? source}` : undefined}
    >
      WAN {version}
      {source && source !== 'model_id' && source !== 'explicit' ? ' ?' : ''}
    </span>
  )
}

/** Renders snippet() output — ⟦…⟧ marks the matched terms. */
function Snippet({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(⟦[^⟧]*⟧)/g), [text])
  return (
    <p className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: C.fg }}>
      {parts.map((p, i) =>
        p.startsWith('⟦') ? (
          <mark key={i} style={{ background: C.green, color: C.bg }}>{p.slice(1, -1)}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] tracking-wider" style={{ color: C.faint }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  background: C.bg,
  border: `2px solid ${C.border}`,
  color: C.fg,
  padding: '4px 6px',
  fontSize: 11,
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-[9px] font-bold px-2 py-1.5 tracking-wider"
      style={{
        border: `2px solid ${on ? C.green : C.border}`,
        background: on ? C.green : 'transparent',
        color: on ? C.bg : C.dim,
      }}
    >
      {children}
    </button>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

function parseAttachments(raw: string | null): Attachment[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Attachment[]) : []
  } catch {
    return []
  }
}

export default function SearchPage() {
  const [rawQ, setRawQ] = useState('')
  const [q, setQ] = useState('')
  const [serverId, setServerId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [author, setAuthor] = useState('')
  const [version, setVersion] = useState('')
  const [minSource, setMinSource] = useState('')
  const [promptsOnly, setPromptsOnly] = useState(false)
  const [withMedia, setWithMedia] = useState(false)
  const [excludeBots, setExcludeBots] = useState(false)
  const [sort, setSort] = useState<'relevance' | 'newest' | 'oldest' | 'promptScore'>('relevance')
  const [page, setPage] = useState(0)
  const LIMIT = 25

  // Debounce so every keystroke is not a query.
  useEffect(() => {
    const t = setTimeout(() => { setQ(rawQ); setPage(0) }, 250)
    return () => clearTimeout(t)
  }, [rawQ])

  /**
   * Changing a filter must send you back to page 1, but doing that in an effect
   * causes a cascading render. So setters are wrapped at the call site instead.
   */
  function withPageReset<T>(setter: (value: T) => void) {
    return (value: T) => { setter(value); setPage(0) }
  }

  const { data: filters } = trpc.search.filters.useQuery()

  const { data, isFetching } = trpc.search.query.useQuery({
    q,
    serverId: serverId || undefined,
    channelId: channelId || undefined,
    author: author || undefined,
    version: version || undefined,
    minSource: (minSource || undefined) as 'model_id' | 'explicit' | 'contextual' | 'channel' | undefined,
    promptsOnly,
    withMedia,
    excludeBots,
    sort,
    limit: LIMIT,
    offset: page * LIMIT,
  }, {
    // Without this, React Query 5 blanks `data` on every refetch, so the list
    // vanishes and "no results" flashes between keystrokes of a debounced search.
    placeholderData: keepPreviousData,
  })

  const channels = useMemo(() => {
    if (!filters) return []
    const list = serverId
      ? filters.servers.find((s) => s.id === serverId)?.channels ?? []
      : filters.servers.flatMap((s) => s.channels)
    return list
  }, [filters, serverId])

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0

  return (
    <div className="p-6 space-y-4" style={{ background: C.bg, minHeight: '100vh' }}>
      {/* Header */}
      <div>
        <h1 className="text-sm font-bold tracking-widest" style={{ color: C.green }}>▤ SEARCH</h1>
        <p className="text-[10px] mt-1" style={{ color: C.faint }}>
          {filters
            ? `${filters.total.toLocaleString()} messages indexed • ${filters.prompts.toLocaleString()} look like prompts`
            : 'loading index…'}
        </p>
      </div>

      {/* Query box */}
      <input
        autoFocus
        value={rawQ}
        onChange={(e) => setRawQ(e.target.value)}
        placeholder='search… "exact phrase", prefix*, AND / OR / NOT'
        className="w-full outline-none"
        style={{ ...inputStyle, fontSize: 13, padding: '10px 12px', borderColor: C.green }}
      />

      {/* Version chips — the primary axis for this archive */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[9px] tracking-wider mr-1" style={{ color: C.faint }}>VERSION</span>
        <Toggle on={version === ''} onClick={() => withPageReset(setVersion)('')}>ALL</Toggle>
        {filters?.versions.map((v) => (
          <Toggle
            key={v.version ?? 'none'}
            on={version === (v.version ?? 'none')}
            onClick={() => withPageReset(setVersion)(version === (v.version ?? 'none') ? '' : (v.version ?? 'none'))}
          >
            {v.version ? `WAN ${v.version}` : 'NONE'} · {v.count.toLocaleString()}
          </Toggle>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end p-3" style={{ background: C.panel, border: `2px solid ${C.border}` }}>
        <Field label="SERVER">
          <select value={serverId} onChange={(e) => { withPageReset(setServerId)(e.target.value); setChannelId('') }} style={inputStyle}>
            <option value="">all servers</option>
            {filters?.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>

        <Field label="CHANNEL">
          <select value={channelId} onChange={(e) => withPageReset(setChannelId)(e.target.value)} style={inputStyle}>
            <option value="">all channels</option>
            {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </Field>

        <Field label="AUTHOR">
          <input value={author} onChange={(e) => withPageReset(setAuthor)(e.target.value)} placeholder="name" style={{ ...inputStyle, width: 110 }} />
        </Field>

        <Field label="CONFIDENCE">
          <select value={minSource} onChange={(e) => withPageReset(setMinSource)(e.target.value)} style={inputStyle}>
            <option value="">any</option>
            <option value="model_id">model id only</option>
            <option value="explicit">named or better</option>
            <option value="contextual">inferred or better</option>
          </select>
        </Field>

        <Field label="SORT">
          <select value={sort} onChange={(e) => withPageReset(setSort)(e.target.value as typeof sort)} style={inputStyle}>
            <option value="relevance">relevance</option>
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
            <option value="promptScore">most prompt-like</option>
          </select>
        </Field>

        <div className="flex gap-1.5">
          <Toggle on={promptsOnly} onClick={() => withPageReset(setPromptsOnly)(!promptsOnly)}>PROMPTS ONLY</Toggle>
          <Toggle on={withMedia} onClick={() => withPageReset(setWithMedia)(!withMedia)}>HAS MEDIA</Toggle>
          <Toggle on={excludeBots} onClick={() => withPageReset(setExcludeBots)(!excludeBots)}>NO BOTS</Toggle>
        </div>
      </div>

      {/* Result summary + in-result version breakdown */}
      <div className="flex items-center justify-between text-[10px]" style={{ color: C.dim }}>
        <span>
          {isFetching ? 'searching…' : `${data?.total.toLocaleString() ?? 0} results`}
          {data?.error ? <span style={{ color: C.red }}> — {data.error}</span> : null}
        </span>
        <span className="flex gap-2">
          {data?.facets.filter((f) => f.version).map((f) => (
            <span key={f.version}>
              <span style={{ color: VERSION_COLOR[f.version!] ?? C.dim }}>■</span> {f.version} {f.count.toLocaleString()}
            </span>
          ))}
        </span>
      </div>

      {/* Results */}
      <div className="space-y-2">
        {data?.hits.map((h) => {
          // Only ingest writes this column, but one hand-edited or truncated row
          // should not take the whole results list down with it.
          const atts: Attachment[] = parseAttachments(h.attachments)
          const jump = `https://discord.com/channels/${h.serverDiscordId}/${h.channelDiscordId}/${h.discordId}`
          return (
            <article key={h.seq} className="p-3" style={{ background: C.panel, border: `2px solid ${C.border}` }}>
              <header className="flex flex-wrap items-center gap-2 mb-2 text-[9px]" style={{ color: C.faint }}>
                <VersionTag version={h.wanVersion} source={h.wanVersionSrc} />
                {h.wanTask && <span style={{ color: C.blue }}>{h.wanTask.toUpperCase()}</span>}
                {h.isPrompt && <span style={{ color: C.green }}>PROMPT {h.promptScore}</span>}
                <span style={{ color: C.dim }}>{h.authorNick || h.authorName}</span>
                {h.isBot && <span style={{ color: C.amber }}>BOT</span>}
                <span>{h.serverName} / #{h.channelName}</span>
                <span>{new Date(h.timestamp).toISOString().slice(0, 10)}</span>
                <a href={jump} target="_blank" rel="noreferrer" className="ml-auto underline" style={{ color: C.blue }}>
                  open in discord ↗
                </a>
              </header>

              <Snippet text={h.snippet} />

              {h.negativePrompt && (
                <p className="mt-2 text-[10px]" style={{ color: C.red }}>
                  <span style={{ color: C.faint }}>negative:</span> {h.negativePrompt.slice(0, 300)}
                </p>
              )}

              {atts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {atts.slice(0, 4).map((a) => (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer"
                       className="text-[9px] px-1.5 py-0.5 underline"
                       style={{ color: C.blue, border: `1px solid ${C.border}` }}>
                      {a.name.slice(0, 36)}
                    </a>
                  ))}
                  {atts.length > 4 && <span className="text-[9px]" style={{ color: C.faint }}>+{atts.length - 4} more</span>}
                </div>
              )}

              {h.promptText && h.promptText !== h.content && (
                <details className="mt-2">
                  <summary className="text-[9px] cursor-pointer" style={{ color: C.faint }}>extracted prompt</summary>
                  <pre className="text-[10px] mt-1 whitespace-pre-wrap" style={{ color: C.green }}>{h.promptText}</pre>
                </details>
              )}
            </article>
          )
        })}

        {data && data.hits.length === 0 && !isFetching && (
          <p className="text-[11px] py-8 text-center" style={{ color: C.faint }}>
            nothing matched. try fewer filters, or a prefix like <code style={{ color: C.green }}>cinemat*</code>
          </p>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-3 justify-center pt-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  className="text-[10px] px-3 py-1.5 font-bold"
                  style={{ border: `2px solid ${C.border}`, color: page === 0 ? C.faint : C.green }}>
            ◀ PREV
          </button>
          <span className="text-[10px]" style={{ color: C.dim }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page + 1 >= totalPages}
                  className="text-[10px] px-3 py-1.5 font-bold"
                  style={{ border: `2px solid ${C.border}`, color: page + 1 >= totalPages ? C.faint : C.green }}>
            NEXT ▶
          </button>
        </div>
      )}
    </div>
  )
}
