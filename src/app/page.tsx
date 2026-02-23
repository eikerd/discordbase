'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'

function StatCard({
  label,
  value,
  color,
  sub,
}: {
  label: string
  value: string | number
  color: string
  sub?: string
}) {
  return (
    <div className="pixel-card">
      <div className="font-bold text-xs mb-2" style={{ color }}>
        {label}
      </div>
      <div className="text-3xl font-bold text-[#00ff41]">{value}</div>
      {sub && <div className="text-xs text-[#a8a8c8] mt-2">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, isError: statsIsError, error: statsError } = trpc.stats.dashboard.useQuery()
  const { data: jobs, isLoading: jobsLoading, isError: jobsIsError, error: jobsError } = trpc.job.recent.useQuery({ limit: 10 })

  const dockerOk = stats?.dockerRunning

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[#00ff41] text-2xl font-bold tracking-widest">DISCORDBASE</h1>
        <p className="text-[#a8a8c8] text-xs mt-1">Local Discord Archive Dashboard</p>
      </div>

      {/* Stats error */}
      {statsIsError && (
        <div
          className="pixel-card text-xs font-mono"
          style={{ borderColor: '#ff004d', color: '#ff004d' }}
        >
          ✕ Failed to load stats: {statsError?.message}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="SERVERS"
          value={statsLoading ? '…' : (stats?.servers ?? 0)}
          color="#29adff"
          sub="Connected"
        />
        <StatCard
          label="CHANNELS"
          value={statsLoading ? '…' : (stats?.channels ?? 0)}
          color="#29adff"
          sub="Tracked"
        />
        <StatCard
          label="JOBS RUN"
          value={statsLoading ? '…' : (stats?.jobsRun ?? 0)}
          color="#ffb000"
          sub="Total"
        />
        <div className="pixel-card">
          <div className="font-bold text-xs mb-2 text-[#ff004d]">DOCKER</div>
          <div
            className="text-xl font-bold mb-1"
            style={{ color: dockerOk ? '#00ff41' : '#ff004d' }}
          >
            {statsLoading ? '…' : dockerOk ? '● ONLINE' : '● OFFLINE'}
          </div>
          <div className="text-xs text-[#a8a8c8]">Daemon</div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="pixel-card">
        <h2 className="text-[#00ff41] font-bold mb-4 text-sm">RECENT JOBS</h2>

        {jobsIsError && (
          <div
            className="text-xs font-mono mb-2"
            style={{ color: '#ff004d' }}
          >
            ✕ Failed to load jobs: {jobsError?.message}
          </div>
        )}

        {jobsLoading ? null : (!jobs || jobs.length === 0) ? (
          <div className="text-[#a8a8c8] text-xs space-y-1">
            <div>&gt; No scrape jobs yet</div>
            <div>&gt; Add a server and channels to get started</div>
          </div>
        ) : (
          <div className="space-y-1 text-xs font-mono">
            {jobs.map((job) => {
              const statusColor =
                job.status === 'done'
                  ? '#00ff41'
                  : job.status === 'failed'
                    ? '#ff004d'
                    : job.status === 'running'
                      ? '#ffb000'
                      : '#a8a8c8'
              return (
                <div key={job.id} className="flex gap-3 items-center">
                  <span style={{ color: statusColor }}>[{job.status.toUpperCase()}]</span>
                  <span className="text-[#e8e8e8]">
                    {job.channel.server.name} / #{job.channel.name}
                  </span>
                  {job.messageCount != null && (
                    <span className="text-[#a8a8c8]">{job.messageCount} msgs</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link href="/servers" className="pixel-button text-xs">
          MANAGE SERVERS
        </Link>
        <Link href="/settings" className="pixel-button text-xs" style={{
          background: '#29adff',
          borderColor: '#29adff',
        }}>
          SETTINGS
        </Link>
      </div>
    </div>
  )
}
