'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

function AddServerForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [discordId, setDiscordId] = useState('')
  const [open, setOpen] = useState(false)

  const add = trpc.server.add.useMutation({
    onSuccess: () => {
      setName('')
      setDiscordId('')
      setOpen(false)
      onAdded()
    },
  })

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
        <p className="text-[9px] text-[#4a4a6a]">
          Right-click server icon in Discord → Copy Server ID (enable Developer Mode first)
        </p>
      </div>
      <div className="flex gap-2">
        <button
          className="pixel-button text-xs"
          disabled={!name || !discordId || add.isPending}
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
      {add.error && (
        <div className="text-[#ff004d] text-xs">{add.error.message}</div>
      )}
    </div>
  )
}

function AddChannelForm({
  serverId,
  onAdded,
}: {
  serverId: string
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [discordId, setDiscordId] = useState('')
  const [open, setOpen] = useState(false)

  const add = trpc.channel.add.useMutation({
    onSuccess: () => {
      setName('')
      setDiscordId('')
      setOpen(false)
      onAdded()
    },
  })

  if (!open) {
    return (
      <button
        className="pixel-button text-[9px]"
        style={{
          background: '#1a2a3a',
          borderColor: '#29adff',
          color: '#29adff',
          padding: '4px 8px',
        }}
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
          disabled={!name || !discordId || add.isPending}
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
      {add.error && <div className="text-[#ff004d] text-[9px]">{add.error.message}</div>}
    </div>
  )
}

function ServerCard({ server, onChanged }: {
  server: {
    id: string
    name: string
    discordId: string
    channels: {
      id: string
      name: string
      discordId: string
      enabled: boolean
      scrapeEvery: number
      lastScraped: string | null
    }[]
  }
  onChanged: () => void
}) {
  const utils = trpc.useUtils()

  const removeServer = trpc.server.remove.useMutation({
    onSuccess: () => onChanged(),
  })
  const removeChannel = trpc.channel.remove.useMutation({
    onSuccess: () => {
      utils.server.list.invalidate()
    },
  })
  const toggleChannel = trpc.channel.toggleEnabled.useMutation({
    onSuccess: () => {
      utils.server.list.invalidate()
    },
  })
  const scanChannel = trpc.job.triggerScrape.useMutation({
    onSuccess: () => {
      utils.server.list.invalidate()
    },
  })

  return (
    <div className="pixel-card space-y-3">
      {/* Server header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[#00ff41] font-bold text-sm">{server.name}</div>
          <div className="text-[#4a4a6a] text-[9px] font-mono mt-0.5">ID: {server.discordId}</div>
        </div>
        <button
          className="pixel-button text-[9px]"
          style={{
            background: '#2a0a0a',
            borderColor: '#ff004d',
            color: '#ff004d',
            padding: '4px 8px',
          }}
          onClick={() => {
            if (confirm(`Delete server "${server.name}" and all its channels?`)) {
              removeServer.mutate({ id: server.id })
            }
          }}
        >
          DELETE
        </button>
      </div>

      {/* Channels */}
      <div className="space-y-1">
        <div className="text-[#a8a8c8] text-[9px] font-bold mb-2">
          CHANNELS ({server.channels.length})
        </div>
        {server.channels.length === 0 && (
          <div className="text-[#4a4a6a] text-xs">No channels yet</div>
        )}
        {server.channels.map((ch) => {
          const isScanning =
            scanChannel.isPending && scanChannel.variables?.channelId === ch.id
          const scanFailed =
            scanChannel.isError && scanChannel.variables?.channelId === ch.id

          // Staleness + 24h cooldown
          const lastScrapedMs = ch.lastScraped ? new Date(ch.lastScraped).getTime() : null
          const msSinceScraped = lastScrapedMs ? Date.now() - lastScrapedMs : null
          const hoursSince = msSinceScraped != null ? msSinceScraped / (1000 * 60 * 60) : null
          const daysSince = hoursSince != null ? Math.floor(hoursSince) < 24
            ? `${Math.round(hoursSince)}h ago`
            : `${Math.floor(hoursSince / 24)}d ago`
            : null
          const onCooldown = hoursSince != null && hoursSince < 24
          const scanBlocked = isScanning || onCooldown

          return (
            <div key={ch.id} className="space-y-0.5">
              <div
                className="flex items-center gap-2 px-2 py-1.5"
                style={{ background: '#0f0f23', border: '1px solid #2a2a4a' }}
              >
                {/* ON/OFF toggle */}
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

                {/* SCAN button */}
                <button
                  className="text-[9px] font-bold px-1.5 py-0.5 border"
                  style={{
                    color: isScanning ? '#ffb000' : onCooldown ? '#4a4a6a' : '#29adff',
                    borderColor: isScanning ? '#ffb000' : onCooldown ? '#4a4a6a' : '#29adff',
                    background: 'transparent',
                    minWidth: '52px',
                    cursor: scanBlocked ? 'not-allowed' : 'pointer',
                    opacity: onCooldown ? 0.5 : 1,
                  }}
                  onClick={() => !scanBlocked && scanChannel.mutate({ channelId: ch.id })}
                  disabled={scanBlocked}
                  title={
                    isScanning ? 'Scanning...' :
                    onCooldown ? `24h cooldown — scanned ${daysSince}` :
                    'Run scrape now'
                  }
                >
                  {isScanning ? '⟳ SCAN' : onCooldown ? '⏸ SCAN' : '▶ SCAN'}
                </button>

                <span className="text-xs text-[#e8e8e8] flex-1">#{ch.name}</span>
                <span className="text-[9px] text-[#4a4a6a] font-mono">{ch.discordId}</span>

                {/* Staleness badge */}
                {daysSince && (
                  <span
                    className="text-[9px] px-1.5 py-0.5"
                    style={{
                      color: onCooldown ? '#ffb000' : hoursSince! > 168 ? '#ff004d' : '#a8a8c8',
                      border: '1px solid',
                      borderColor: onCooldown ? '#ffb000' : hoursSince! > 168 ? '#ff004d' : '#2a2a4a',
                    }}
                    title={`Last scraped: ${new Date(ch.lastScraped!).toLocaleString()}`}
                  >
                    {daysSince}
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

              {/* Scan error */}
              {scanFailed && (
                <div
                  className="text-[9px] px-2 py-1 font-mono"
                  style={{ background: '#2a0a0a', color: '#ff004d', border: '1px solid #ff004d' }}
                >
                  ✕ {scanChannel.error?.message}
                </div>
              )}
            </div>
          )
        })}
        <AddChannelForm serverId={server.id} onAdded={() => utils.server.list.invalidate()} />
      </div>
    </div>
  )
}

export default function ServersPage() {
  const utils = trpc.useUtils()
  const { data: servers, isLoading } = trpc.server.list.useQuery()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[#00ff41] text-2xl font-bold tracking-widest">SERVERS</h1>
        <p className="text-[#a8a8c8] text-xs mt-1">Manage Discord servers and channels to archive</p>
      </div>

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
            onChanged={() => utils.server.list.invalidate()}
          />
        ))}
      </div>
    </div>
  )
}
