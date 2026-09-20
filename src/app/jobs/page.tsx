'use client'

import { useState } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { trpc } from '@/lib/trpc'

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

const STATUS_COLOR: Record<string, string> = {
  done: C.green,
  running: C.blue,
  pending: C.dim,
  partial: C.amber,
  failed: C.red,
}

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'SCAN button',
  scheduled: 'launchd',
  backfill: 'backfill',
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function bytes(n: number | null): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${(n / 1_073_741_824).toFixed(2)} GB`
}

function duration(ms: number | null): string {
  if (ms === null || ms < 0) return '—'
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function when(iso: string | Date): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function Stat({ label, value, color = C.fg }: { label: string; value: string; color?: string }) {
  return (
    <div className="px-3 py-2" style={{ background: C.panel, border: `2px solid ${C.border}`, minWidth: 110 }}>
      <div className="text-[9px] tracking-wider" style={{ color: C.faint }}>{label}</div>
      <div className="text-sm font-bold mt-0.5" style={{ color }}>{value}</div>
    </div>
  )
}

function Cell({ label, value, color = C.fg }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[9px]" style={{ color: C.faint }}>{label}</div>
      <div className="text-[11px]" style={{ color }}>{value}</div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [status, setStatus] = useState<'all' | 'done' | 'failed' | 'running' | 'partial'>('all')
  const [page, setPage] = useState(0)
  const LIMIT = 25

  // A scrape can be in flight, so keep it live.
  const { data } = trpc.job.log.useQuery(
    { status, limit: LIMIT, offset: page * LIMIT },
    // keepPreviousData so the 10s poll and the status filter swap rows in place
    // instead of emptying the table on every refetch.
    { refetchInterval: 10_000, placeholderData: keepPreviousData },
  )

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0

  return (
    <div className="p-6 space-y-4" style={{ background: C.bg, minHeight: '100vh' }}>
      <div>
        <h1 className="text-sm font-bold tracking-widest" style={{ color: C.green }}>⟳ SYNC LOG</h1>
        <p className="text-[10px] mt-1" style={{ color: C.faint }}>
          every export and ingest, newest first — refreshes every 10s
        </p>
      </div>

      {data && (
        <div className="flex flex-wrap gap-2">
          <Stat label="COMPLETED SYNCS" value={data.summary.completed.toLocaleString()} color={C.green} />
          <Stat label="MESSAGES EXPORTED" value={data.summary.messages.toLocaleString()} />
          <Stat label="ROWS INGESTED" value={data.summary.ingested.toLocaleString()} />
          <Stat label="PROMPTS FOUND" value={data.summary.prompts.toLocaleString()} color={C.amber} />
          <Stat label="ON DISK" value={bytes(data.summary.bytes)} color={C.blue} />
        </div>
      )}

      <div className="flex gap-1.5">
        {(['all', 'done', 'running', 'partial', 'failed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(0) }}
            className="text-[9px] font-bold px-2 py-1.5 tracking-wider"
            style={{
              border: `2px solid ${status === s ? C.green : C.border}`,
              background: status === s ? C.green : 'transparent',
              color: status === s ? C.bg : C.dim,
            }}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {data?.jobs.map((j) => {
          const started = j.startedAt ? new Date(j.startedAt).getTime() : null
          const finished = j.finishedAt ? new Date(j.finishedAt).getTime() : null
          const ms = started && finished ? finished - started : null
          const mins = ms ? ms / 60_000 : null

          const throughput =
            mins && mins > 0 && j.exportBytes
              ? `${(j.exportBytes / 1_048_576 / mins).toFixed(1)} MB/min`
              : '—'
          const rate =
            ms && ms > 0 && j.messageCount
              ? `${Math.round(j.messageCount / (ms / 1000)).toLocaleString()} msg/s`
              : '—'

          return (
            <article key={j.id} className="p-3" style={{ background: C.panel, border: `2px solid ${C.border}` }}>
              <header className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5"
                  style={{ background: STATUS_COLOR[j.status] ?? C.dim, color: C.bg }}
                >
                  {j.status.toUpperCase()}
                </span>
                <span className="text-[11px] font-bold" style={{ color: C.fg }}>
                  {j.channel.server.name} / #{j.channel.name}
                </span>
                <span className="text-[9px]" style={{ color: C.faint }}>
                  via {TRIGGER_LABEL[j.trigger] ?? j.trigger}
                </span>
                <span className="text-[9px] ml-auto" style={{ color: C.dim }}>{when(j.createdAt)}</span>
              </header>

              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                <Cell label="DURATION" value={duration(ms)} color={C.blue} />
                <Cell label="EXPORTED" value={j.messageCount?.toLocaleString() ?? '—'} />
                <Cell label="INGESTED" value={j.ingestedCount?.toLocaleString() ?? '—'} />
                <Cell label="PROMPTS" value={j.promptCount?.toLocaleString() ?? '—'} color={C.amber} />
                <Cell label="SIZE" value={bytes(j.exportBytes)} />
                <Cell label="THROUGHPUT" value={`${throughput}${rate !== '—' ? ` · ${rate}` : ''}`} color={C.dim} />
              </div>

              {j.outputPath && (
                <p className="mt-2 text-[9px] break-all" style={{ color: C.faint }}>
                  → {j.outputPath}
                </p>
              )}

              {j.errorLog && (
                <details className="mt-2">
                  <summary className="text-[9px] cursor-pointer" style={{ color: C.red }}>
                    {j.failedStage ? `${j.failedStage} error` : 'error'} — show detail
                  </summary>
                  <pre
                    className="text-[10px] mt-1 p-2 whitespace-pre-wrap break-all"
                    style={{ color: C.red, background: C.bg, border: `1px solid ${C.border}` }}
                  >
                    {j.errorLog}
                  </pre>
                </details>
              )}
            </article>
          )
        })}

        {data && data.jobs.length === 0 && (
          <p className="text-[11px] py-8 text-center" style={{ color: C.faint }}>
            no sync events yet
          </p>
        )}
      </div>

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
