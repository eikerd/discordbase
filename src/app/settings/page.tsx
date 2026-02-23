'use client'

import { useState, useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc'

type FormState = {
  token: string
  exportFormat: string
  outputDir: string
}

export default function SettingsPage() {
  const { data: config, isLoading } = trpc.config.get.useQuery()
  const update = trpc.config.update.useMutation()

  const [form, setForm] = useState<FormState>({
    token: '',
    exportFormat: 'Json',
    outputDir: './exports',
  })
  const [showToken, setShowToken] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (config) {
      setForm({
        token: config.discordToken ?? '',
        exportFormat: config.exportFormat ?? 'Json',
        outputDir: config.outputDir ?? './exports',
      })
    }
  }, [config])

  useEffect(() => {
    return () => {
      if (savedTimerRef.current != null) {
        clearTimeout(savedTimerRef.current)
      }
    }
  }, [])

  async function handleSave() {
    setSaveError(null)
    try {
      await update.mutateAsync({
        discordToken: form.token,
        exportFormat: form.exportFormat,
        outputDir: form.outputDir,
      })
      setSaved(true)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (isLoading) return <div className="text-[#a8a8c8] text-xs">Loading…</div>

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-[#00ff41] text-2xl font-bold tracking-widest">SETTINGS</h1>
        <p className="text-[#a8a8c8] text-xs mt-1">Configure Discord token and export options</p>
      </div>

      {/* Token */}
      <div className="pixel-card space-y-3">
        <div className="text-[#00ff41] font-bold text-xs">DISCORD TOKEN</div>
        <div className="text-[#a8a8c8] text-xs space-y-1">
          <p>Your user token is used by DiscordChatExporter (runs in Docker).</p>
          <p className="text-[#ffb000]">⚠ Never share this token. It stays local in SQLite.</p>
        </div>
        <div>
          <label className="text-xs text-[#a8a8c8] block mb-1">Token</label>
          <div className="flex gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              className="flex-1 bg-[#0f0f23] border-2 border-[#2a2a4a] text-[#e8e8e8] text-xs px-3 py-2 outline-none focus:border-[#00ff41] font-mono"
              placeholder="Paste your Discord token here"
              value={form.token}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
            />
            <button
              className="pixel-button text-[9px]"
              style={{ background: '#2a2a4a', borderColor: '#2a2a4a', color: '#e8e8e8' }}
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? 'HIDE' : 'SHOW'}
            </button>
          </div>
          <p className="text-[9px] text-[#4a4a6a] mt-1">
            Get token: Open Discord in browser → DevTools → Network → filter &quot;api/v&quot; → copy &quot;Authorization&quot; header
          </p>
        </div>
      </div>

      {/* Export Options */}
      <div className="pixel-card space-y-3">
        <div className="text-[#00ff41] font-bold text-xs">EXPORT OPTIONS</div>

        <div>
          <label className="text-xs text-[#a8a8c8] block mb-1">Export Format</label>
          <select
            className="w-full bg-[#0f0f23] border-2 border-[#2a2a4a] text-[#e8e8e8] text-xs px-3 py-2 outline-none focus:border-[#00ff41]"
            value={form.exportFormat}
            onChange={(e) => setForm((f) => ({ ...f, exportFormat: e.target.value }))}
          >
            <option value="Json">JSON</option>
            <option value="HtmlDark">HTML (Dark)</option>
            <option value="HtmlLight">HTML (Light)</option>
            <option value="Csv">CSV</option>
            <option value="PlainText">Plain Text</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-[#a8a8c8] block mb-1">Output Directory</label>
          <input
            className="w-full bg-[#0f0f23] border-2 border-[#2a2a4a] text-[#e8e8e8] text-xs px-3 py-2 outline-none focus:border-[#00ff41] font-mono"
            placeholder="./exports"
            value={form.outputDir}
            onChange={(e) => setForm((f) => ({ ...f, outputDir: e.target.value }))}
          />
          <p className="text-[9px] text-[#4a4a6a] mt-1">
            Relative to the app root or absolute path
          </p>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          className="pixel-button text-xs"
          onClick={handleSave}
          disabled={update.isPending}
        >
          {update.isPending ? 'SAVING…' : 'SAVE SETTINGS'}
        </button>
        {saved && <span className="text-[#00ff41] text-xs">✓ Saved</span>}
        {saveError && (
          <span className="text-[#ff004d] text-xs">{saveError}</span>
        )}
      </div>
    </div>
  )
}
