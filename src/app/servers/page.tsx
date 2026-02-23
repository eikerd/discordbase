'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { trpc } from '@/lib/trpc'

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = {
  id: string
  name: string
  discordId: string
  enabled: boolean
  scrapeEvery: number
  lastScraped: string | null
}

type Server = {
  id: string
  name: string
  discordId: string
  channels: Channel[]
}

// ─── Snowflake validation ─────────────────────────────────────────────────────

const SNOWFLAKE_RE = /^\d{17,20}$/

// ─── Scanning overlay ─────────────────────────────────────────────────────────

function ScanningOverlay({
  channelName,
  serverName,
  elapsed,
}: {
  channelName: string
  serverName: string
  elapsed: number
}) {
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const secs = String(elapsed % 60).padStart(2, '0')

  return (
    <div
      className="pixel-card space-y-3"
      style={{
        borderColor: '#00ff41',
        animation: 'scan-pulse 1.5s ease-in-out infinite',
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="text-[#00ff41] font-bold text-xs"
            style={{ animation: 'pixel-blink 1s step-end infinite' }}
          >
            ⟳
          </span>
          <span className="text-[#00ff41] font-bold text-sm tracking-widest">
            SCANNING IN PROGRESS
          </span>
        </div>
        <span className="text-[#00ff41] font-bold font-mono text-lg tracking-widest">
          {mins}:{secs}
        </span>
      </div>

      {/* Channel info */}
      <div className="text-xs text-[#e8e8e8]">
        <span className="text-[#a8a8c8]">{serverName}</span>
        <span className="text-[#4a4a6a]"> / </span>
        <span className="text-[#00ff41] font-bold">#{channelName}</span>
      </div>

      {/* Animated progress bar */}
      <div
        className="relative overflow-hidden h-4"
        style={{ background: '#0a0a1a', border: '2px solid #2a2a4a' }}
      >
        {/* Track fill */}
        <div className="absolute inset-0" style={{ background: '#0d2a0d' }} />
        {/* Scan beam */}
        <div
          className="absolute top-0 bottom-0 w-1/3"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(0,255,65,0.6), rgba(0,255,65,1), rgba(0,255,65,0.6), transparent)',
            animation: 'scan-beam 1.4s linear infinite',
          }}
        />
        {/* Timer overlay text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] font-bold text-[#00ff41] tracking-widest" style={{ mixBlendMode: 'screen' }}>
            FETCHING MESSAGES...
          </span>
        </div>
      </div>

      {/* Warning */}
      <div className="text-[9px] text-[#ffb000] font-mono">
        ⚠ Do not close this window — Docker is running in the background.
        Large channels can take several minutes.
      </div>
    </div>
  )
}

// ─── Add Server form ──────────────────────────────────────────────────────────

function AddServerForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [discordId, setDiscordId] = useState('')
  const [open, setOpen] = useState(false)

  const add = trpc.server.add.useMutation({
    onSuccess: () => { setName(''); setDiscordId(''); setOpen(false); onAdded() },
  })

  const idValid = SNOWFLAKE_RE.test(discordId)
  const idInvalid = discordId.length > 0 && !idValid

  if (!open) {
    return (
      <button className="pixel-button text-xs" onClick={() => setOpen(true)}>
        + ADD SERVER
      </button>
    )
  }

  return (
    <div className="pixel-card space-y-3 max-w-md">
      <div className="text-[#00ff41] font-bold text-xs">ADD SERVER</div>
      <div className="space-y-2">
        <label className="text-xs text-[#a8a8c8] block">Server Name (label)</label>
        <input
          className="w-full bg-[#0f0f23] border-2 border-[#2a2a4a] text-[#e8e8e8] text-xs px-3 py-2 outline-none focus:border-[#00ff41]"
          placeholder="e.g. My Server"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs text-[#a8a8c8] block">Discord Server ID</label>
        <input
          className="w-full bg-[#0f0f23] border-2 border-[#2a2a4a] text-[#e8e8e8] text-xs px-3 py-2 outline-none focus:border-[#00ff41] font-mono"
          placeholder="e.g. 123456789012345678"
          value={discordId}
          onChange={(e) => setDiscordId(e.target.value)}
        />
        {idInvalid && (
          <p className="text-[9px] text-[#ff004d]">Invalid Discord ID format</p>
        )}
        <p className="text-[9px] text-[#4a4a6a]">
          Right-click server icon in Discord → Copy Server ID (enable Developer Mode first)
        </p>
      </div>
      <div className="flex gap-2">
        <button
          className="pixel-button text-xs"
          disabled={!name || !idValid || add.isPending}
          onClick={() => add.mutate({ name, discordId })}
        >
          {add.isPending ? 'SAVING…' : 'SAVE'}
        </button>
        <button
          className="pixel-button text-xs"
          style={{ background: '#2a2a4a', borderColor: '#2a2a4a', color: '#e8e8e8' }}
          onClick={() => setOpen(false)}
        >
          CANCEL
        </button>
      </div>
      {add.error && <div className="text-[#ff004d] text-xs">{add.error.message}</div>}
    </div>
  )
}

// ─── Add Channel form ─────────────────────────────────────────────────────────

function AddChannelForm({ serverId, onAdded }: { serverId: string; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [discordId, setDiscordId] = useState('')
  const [open, setOpen] = useState(false)

  const add = trpc.channel.add.useMutation({
    onSuccess: () => { setName(''); setDiscordId(''); setOpen(false); onAdded() },
  })

  const idValid = SNOWFLAKE_RE.test(discordId)
  const idInvalid = discordId.length > 0 && !idValid

  if (!open) {
    return (
      <button
        className="pixel-button text-[9px]"
        style={{ background: '#1a2a3a', borderColor: '#29adff', color: '#29adff', padding: '4px 8px' }}
        onClick={() => setOpen(true)}
      >
        + CHANNEL
      </button>
    )
  }

  return (
    <div className="mt-2 p-3 space-y-2" style={{ background: '#0f1a2a', border: '1px solid #29adff' }}>
      <div className="text-[#29adff] font-bold text-[9px]">ADD CHANNEL</div>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-[#0f0f23] border border-[#2a2a4a] text-[#e8e8e8] text-xs px-2 py-1 outline-none focus:border-[#29adff]"
          placeholder="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="flex-1 bg-[#0f0f23] border border-[#2a2a4a] text-[#e8e8e8] text-xs px-2 py-1 outline-none focus:border-[#29adff] font-mono"
          placeholder="Channel ID"
          value={discordId}
          onChange={(e) => setDiscordId(e.target.value)}
        />
        <button
          className="pixel-button text-[9px]"
          style={{ padding: '4px 8px' }}
          disabled={!name || !idValid || add.isPending}
          onClick={() => add.mutate({ serverId, name, discordId })}
        >
          {add.isPending ? '…' : 'ADD'}
        </button>
        <button
          className="pixel-button text-[9px]"
          style={{ background: '#2a2a4a', borderColor: '#2a2a4a', color: '#e8e8e8', padding: '4px 8px' }}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>
      {idInvalid && (
        <p className="text-[9px] text-[#ff004d]">Invalid Discord ID format</p>
      )}
      {add.error && <div className="text-[#ff004d] text-[9px]">{add.error.message}</div>}
    </div>
  )
}

// ─── Channel row ──────────────────────────────────────────────────────────────

function ChannelRow({
  ch,
  server,
  now,
  anyScanning,
  onChanged,
  onScanStart,
  onScanSettled,
}: {
  ch: Channel
  server: Server
  now: number
  anyScanning: boolean
  onChanged: () => void
  onScanStart: (channelName: string, serverName: string) => void
  onScanSettled: () => void
}) {
  const utils = trpc.useUtils()

  const removeChannel = trpc.channel.remove.useMutation({
    onSuccess: () => utils.server.list.invalidate(),
  })
  const toggleChannel = trpc.channel.toggleEnabled.useMutation({
    onSuccess: () => utils.server.list.invalidate(),
  })
  const scanMutation = trpc.job.triggerScrape.useMutation({
    onMutate: () => {
      onScanStart(ch.name, server.name)
    },
    onSettled: () => {
      onScanSettled()
      onChanged()
    },
  })

  const lastScrapedMs = ch.lastScraped ? new Date(ch.lastScraped).getTime() : null
  const hoursSince = lastScrapedMs ? (now - lastScrapedMs) / 3_600_000 : null
  const ageBadge = hoursSince == null ? null
    : hoursSince < 1 ? `${Math.round(hoursSince * 60)}m ago`
    : hoursSince < 24 ? `${Math.round(hoursSince)}h ago`
    : `${Math.floor(hoursSince / 24)}d ago`
  const onCooldown = hoursSince != null && hoursSince < 24

  const isScanning = scanMutation.isPending
  const scanFailed = scanMutation.isError
  const scanBlocked = isScanning || onCooldown || anyScanning

  return (
    <div className="space-y-0.5">
      <div
        className="flex items-center gap-2 px-2 py-1.5"
        style={{
          background: isScanning ? '#0a1a0a' : '#0f0f23',
          border: `1px solid ${isScanning ? '#00ff41' : '#2a2a4a'}`,
          transition: 'all 0.2s',
        }}
      >
        {/* ON/OFF */}
        <button
          className="text-[9px] font-bold px-1.5 py-0.5 border"
          style={{
            color: ch.enabled ? '#00ff41' : '#4a4a6a',
            borderColor: ch.enabled ? '#00ff41' : '#4a4a6a',
            background: 'transparent',
          }}
          onClick={() => toggleChannel.mutate({ id: ch.id })}
          title="Toggle scheduled scraping"
        >
          {ch.enabled ? 'ON' : 'OFF'}
        </button>

        {/* SCAN */}
        <button
          className="text-[9px] font-bold px-1.5 py-0.5 border"
          style={{
            color: isScanning ? '#ffb000' : onCooldown ? '#4a4a6a' : anyScanning ? '#4a4a6a' : '#29adff',
            borderColor: isScanning ? '#ffb000' : onCooldown ? '#4a4a6a' : anyScanning ? '#4a4a6a' : '#29adff',
            background: 'transparent',
            minWidth: '52px',
            cursor: scanBlocked ? 'not-allowed' : 'pointer',
            opacity: (onCooldown || (anyScanning && !isScanning)) ? 0.4 : 1,
          }}
          onClick={() => !scanBlocked && scanMutation.mutate({ channelId: ch.id })}
          disabled={scanBlocked}
          title={
            isScanning ? 'Scanning...' :
            onCooldown ? `24h cooldown — scanned ${ageBadge}` :
            anyScanning ? 'Another scan in progress' :
            'Run scrape now'
          }
        >
          {isScanning ? '⟳ SCAN' : onCooldown ? '⏸ SCAN' : '▶ SCAN'}
        </button>

        <span className="text-xs text-[#e8e8e8] flex-1">#{ch.name}</span>
        <span className="text-[9px] text-[#4a4a6a] font-mono">{ch.discordId}</span>

        {ageBadge && (
          <span
            className="text-[9px] px-1.5 py-0.5"
            style={{
              color: onCooldown ? '#ffb000' : hoursSince! > 168 ? '#ff004d' : '#a8a8c8',
              border: '1px solid',
              borderColor: onCooldown ? '#ffb000' : hoursSince! > 168 ? '#ff004d' : '#2a2a4a',
            }}
            title={`Last scraped: ${new Date(ch.lastScraped!).toLocaleString()}`}
          >
            {ageBadge}
          </span>
        )}

        <button
          className="text-[#ff004d] text-[9px] px-1"
          onClick={() => removeChannel.mutate({ id: ch.id })}
          title="Remove channel"
        >
          ✕
        </button>
      </div>

      {scanFailed && (
        <div
          className="text-[9px] px-2 py-1 font-mono"
          style={{ background: '#2a0a0a', color: '#ff004d', border: '1px solid #ff004d' }}
        >
          ✕ {scanMutation.error?.message}
        </div>
      )}
    </div>
  )
}

// ─── Server card ──────────────────────────────────────────────────────────────

function ServerCard({
  server,
  now,
  anyScanning,
  onChanged,
  onScanStart,
  onScanSettled,
}: {
  server: Server
  now: number
  anyScanning: boolean
  onChanged: () => void
  onScanStart: (channelName: string, serverName: string) => void
  onScanSettled: () => void
}) {
  const utils = trpc.useUtils()
  const removeServer = trpc.server.remove.useMutation({ onSuccess: onChanged })

  return (
    <div className="pixel-card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[#00ff41] font-bold text-sm">{server.name}</div>
          <div className="text-[#4a4a6a] text-[9px] font-mono mt-0.5">ID: {server.discordId}</div>
        </div>
        <button
          className="pixel-button text-[9px]"
          style={{ background: '#2a0a0a', borderColor: '#ff004d', color: '#ff004d', padding: '4px 8px' }}
          onClick={() => {
            if (confirm(`Delete server "${server.name}" and all its channels?`))
              removeServer.mutate({ id: server.id })
          }}
        >
          DELETE
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[#a8a8c8] text-[9px] font-bold mb-2">
          CHANNELS ({server.channels.length})
        </div>
        {server.channels.length === 0 && (
          <div className="text-[#4a4a6a] text-xs">No channels yet</div>
        )}

        {server.channels.map((ch) => (
          <ChannelRow
            key={ch.id}
            ch={ch}
            server={server}
            now={now}
            anyScanning={anyScanning}
            onChanged={onChanged}
            onScanStart={onScanStart}
            onScanSettled={onScanSettled}
          />
        ))}

        <AddChannelForm serverId={server.id} onAdded={() => utils.server.list.invalidate()} />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ServersPage() {
  const utils = trpc.useUtils()
  const { data: servers, isLoading } = trpc.server.list.useQuery()

  // Stable `now` value — initialized once, avoids non-deterministic re-renders
  const now = useMemo(() => Date.now(), [])

  // Track whether any scan is in progress across all ChannelRow instances
  const [anyScanning, setAnyScanning] = useState(false)

  // Elapsed timer for the scanning overlay
  const startRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [scanningChannel, setScanningChannel] = useState<{ name: string; serverName: string } | null>(null)

  useEffect(() => {
    if (anyScanning) {
      if (!startRef.current) startRef.current = Date.now()
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000))
      }, 1000)
      return () => clearInterval(id)
    }
    // reset is handled in onSettled of each ChannelRow mutation via the callback
  }, [anyScanning])

  function handleScanStart(channelName: string, serverName: string) {
    setAnyScanning(true)
    setScanningChannel({ name: channelName, serverName })
  }

  function handleScanSettled() {
    setAnyScanning(false)
    setScanningChannel(null)
    setElapsed(0)
    startRef.current = null
    utils.server.list.invalidate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[#00ff41] text-2xl font-bold tracking-widest">SERVERS</h1>
        <p className="text-[#a8a8c8] text-xs mt-1">Manage Discord servers and channels to archive</p>
      </div>

      {/* Scanning overlay — appears above everything while active */}
      {anyScanning && scanningChannel && (
        <ScanningOverlay
          channelName={scanningChannel.name}
          serverName={scanningChannel.serverName}
          elapsed={elapsed}
        />
      )}

      <AddServerForm onAdded={() => utils.server.list.invalidate()} />

      {isLoading && <div className="text-[#a8a8c8] text-xs">Loading…</div>}

      {!isLoading && servers?.length === 0 && (
        <div className="pixel-card text-center py-8">
          <div className="text-[#4a4a6a] text-sm mb-2">No servers added yet</div>
          <div className="text-[#4a4a6a] text-xs">
            Add a server above to start archiving Discord channels
          </div>
        </div>
      )}

      <div className="space-y-4">
        {servers?.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            now={now}
            anyScanning={anyScanning}
            onChanged={() => utils.server.list.invalidate()}
            onScanStart={handleScanStart}
            onScanSettled={handleScanSettled}
          />
        ))}
      </div>
    </div>
  )
}
