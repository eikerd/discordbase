'use client'

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#00ff41] mb-2">DISCORDBASE</h1>
        <p className="text-[#a8a8c8] text-sm">Local Discord Archive Dashboard</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="pixel-card">
          <div className="text-[#29adff] font-bold text-xs mb-2">SERVERS</div>
          <div className="text-3xl font-bold text-[#00ff41]">—</div>
          <div className="text-xs text-[#a8a8c8] mt-2">Connected</div>
        </div>
        <div className="pixel-card">
          <div className="text-[#29adff] font-bold text-xs mb-2">CHANNELS</div>
          <div className="text-3xl font-bold text-[#00ff41]">—</div>
          <div className="text-xs text-[#a8a8c8] mt-2">Tracked</div>
        </div>
        <div className="pixel-card">
          <div className="text-[#ffb000] font-bold text-xs mb-2">JOBS</div>
          <div className="text-3xl font-bold text-[#00ff41]">—</div>
          <div className="text-xs text-[#a8a8c8] mt-2">Completed</div>
        </div>
        <div className="pixel-card">
          <div className="text-[#ff004d] font-bold text-xs mb-2">DOCKER</div>
          <div className="text-xl font-bold text-[#ff004d] mb-1">●</div>
          <div className="text-xs text-[#a8a8c8]">Status</div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="pixel-card">
        <h2 className="text-[#00ff41] font-bold mb-4">ACTIVITY LOG</h2>
        <div className="space-y-2 text-xs font-mono">
          <div className="text-[#a8a8c8]">&gt; Waiting for scrape jobs...</div>
          <div className="text-[#a8a8c8]">&gt; App initialized</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <button className="pixel-button text-xs">
          SETTINGS
        </button>
        <button className="pixel-button text-xs">
          SERVERS
        </button>
        <button className="pixel-button text-xs">
          JOBS
        </button>
      </div>
    </div>
  );
}
