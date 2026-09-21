/**
 * Docker/DCE mechanics. Deliberately free of `server-only` so the scheduler
 * script can drive an export too — app code must still import `./docker`,
 * which is the server-only facade over this file.
 */
import { spawn, execFileSync } from 'child_process'
import path from 'path'
import fs from 'fs'

const IMAGE = 'tyrrrz/discordchatexporter:stable'
// Short probes (docker info / image inspect) should die fast.
const PROBE_TIMEOUT_MS = 60_000
// A pull can be slow on a cold cache.
const PULL_TIMEOUT_MS = 15 * 60_000
// An export is not a probe: a busy channel legitimately runs for hours, so the
// watchdog is idle-based — it only fires when DCE has gone quiet — with an
// absolute ceiling as a backstop.
const EXPORT_IDLE_TIMEOUT_MS = 20 * 60_000
const EXPORT_MAX_MS = 12 * 60 * 60_000

// Ring buffer that keeps only the last N lines
class RingBuffer {
  private buf: string[] = []
  private size: number
  constructor(size: number) { this.size = size }
  push(line: string) {
    if (this.buf.length >= this.size) this.buf.shift()
    this.buf.push(line)
  }
  lines(): string[] { return this.buf.slice() }
}

// Resolve docker binary — Next.js spawns with a stripped PATH on macOS
function findDocker(): string {
  const candidates = [
    'docker',
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/usr/bin/docker',
  ]
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 5000 })
      console.log(`[docker] Found docker at: ${bin}`)
      return bin
    } catch {
      // try next
    }
  }
  throw new Error(
    'docker not found. Make sure Docker Desktop is running and docker is in PATH.'
  )
}

let resolvedDockerBin: string | null = null
function dockerBin(): string {
  if (!resolvedDockerBin) resolvedDockerBin = findDocker()
  return resolvedDockerBin
}

export interface ExportResult {
  messageCount: number
  outputPath: string
  /** Size of the file DCE produced, for the sync log. */
  bytes: number
}

export async function checkDockerAvailable(): Promise<boolean> {
  console.log('[docker] Checking Docker daemon...')
  try {
    const bin = dockerBin()
    return await new Promise((resolve, reject) => {
      const proc = spawn(bin, ['info'], { stdio: 'ignore' })
      const killTimer = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(new Error('[docker] checkDockerAvailable timed out — killing process'))
      }, PROBE_TIMEOUT_MS)
      proc.on('close', (code) => {
        clearTimeout(killTimer)
        console.log(`[docker] daemon check exit code: ${code}`)
        resolve(code === 0)
      })
      proc.on('error', (err) => {
        clearTimeout(killTimer)
        console.error('[docker] daemon check error:', err.message)
        resolve(false)
      })
    })
  } catch (err) {
    console.error('[docker] checkDockerAvailable failed:', err)
    return false
  }
}

export async function ensureImage(): Promise<void> {
  const bin = dockerBin()
  console.log(`[docker] Checking for image: ${IMAGE}`)

  const present = await new Promise<boolean>((resolve, reject) => {
    const check = spawn(bin, ['image', 'inspect', IMAGE], { stdio: 'ignore' })
    const killTimer = setTimeout(() => {
      check.kill('SIGKILL')
      reject(new Error('[docker] ensureImage inspect timed out — killing process'))
    }, PROBE_TIMEOUT_MS)
    check.on('close', (code) => { clearTimeout(killTimer); resolve(code === 0) })
    check.on('error', () => { clearTimeout(killTimer); resolve(false) })
  })

  if (present) {
    console.log(`[docker] Image already present — skip pull`)
    return
  }

  console.log(`[docker] Pulling ${IMAGE} ...`)
  await new Promise<void>((resolve, reject) => {
    const pull = spawn(bin, ['pull', IMAGE])
    const killTimer = setTimeout(() => {
      pull.kill('SIGKILL')
      reject(new Error('[docker] ensureImage pull timed out — killing process'))
    }, PULL_TIMEOUT_MS)
    pull.stdout.on('data', (d: Buffer) =>
      d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`[docker:pull]  ${l}`))
    )
    pull.stderr.on('data', (d: Buffer) =>
      d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`[docker:pull]  ${l}`))
    )
    pull.on('close', (code) => {
      clearTimeout(killTimer)
      if (code === 0) { console.log('[docker] Pull complete'); resolve() }
      else reject(new Error(`docker pull exited with code ${code}`))
    })
    pull.on('error', (err) => { clearTimeout(killTimer); reject(err) })
  })
}

// Exported so other modules can resolve the output directory without duplicating
// the path-sanitisation logic that lives here.
export function getChannelOutputDir(opts: {
  serverName: string
  channelName: string
  outputDir: string
}): string {
  const safeServer = opts.serverName.replace(/[^\w-]/g, '_')
  const safeChannel = opts.channelName.replace(/[^\w-]/g, '_')
  return path.resolve(process.cwd(), opts.outputDir, safeServer, safeChannel)
}

/**
 * Read the `messageCount` field from the tail of a DCE Json export.
 * Returns 0 for other formats or if the field is missing.
 */
function readMessageCount(filePath: string): number {
  try {
    if (!filePath.endsWith('.json')) return 0
    const size = fs.statSync(filePath).size
    const span = Math.min(size, 4096)
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(span)
      fs.readSync(fd, buf, 0, span, size - span)
      const match = buf.toString('utf8').match(/"messageCount"\s*:\s*(\d+)/)
      return match ? parseInt(match[1], 10) : 0
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    console.warn('[docker] could not read messageCount:', err)
    return 0
  }
}

export async function runChannelExport(opts: {
  token: string
  channelDiscordId: string
  serverName: string
  channelName: string
  format: string
  outputDir: string
  /** Discord message id to resume from — makes the run incremental. */
  after?: string | null
}): Promise<ExportResult> {
  const { token, channelDiscordId, serverName, channelName, format, outputDir, after } = opts
  const bin = dockerBin()

  const safeServer = serverName.replace(/[^\w-]/g, '_')
  const safeChannel = channelName.replace(/[^\w-]/g, '_')
  const hostOutDir = path.resolve(process.cwd(), outputDir, safeServer, safeChannel)

  console.log(`[docker] ── Export ──────────────────────────────────────`)
  console.log(`[docker]   Channel ID  : ${channelDiscordId}`)
  console.log(`[docker]   Server      : ${serverName}`)
  console.log(`[docker]   Channel     : #${channelName}`)
  console.log(`[docker]   Format      : ${format}`)
  console.log(`[docker]   Output dir  : ${hostOutDir}`)
  console.log(`[docker]   Mode        : ${after ? `incremental (after ${after})` : 'full'}`)
  console.log(`[docker]   Docker bin  : ${bin}`)

  fs.mkdirSync(hostOutDir, { recursive: true })

  // Pass token via env var — DCE supports DISCORD_TOKEN env var
  const args = [
    'run', '--rm',
    '-v', `${hostOutDir}:/app/out`,
    '-e', `DISCORD_TOKEN=${token}`,
    IMAGE,
    'export',
    '--channel', channelDiscordId,
    '--format', format,
    '--output', '/app/out/',
    '--include-threads', 'all',
    // Incremental: only messages newer than what we already hold. Cuts a resync
    // from the whole channel to the handful of messages that actually arrived.
    ...(after ? ['--after', after] : []),
  ]

  // Log args with token env var redacted
  const safeArgs = args.map((a, i) => (args[i - 1] === '-e' ? 'DISCORD_TOKEN=***' : a))
  console.log(`[docker] CMD: ${bin} ${safeArgs.join(' ')}`)

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    const stdoutBuf = new RingBuffer(50)
    const stderrBuf = new RingBuffer(50)

    // Idle watchdog: reset on every line DCE prints. A long export is normal;
    // an export that has said nothing for 20 minutes is stuck.
    let idleTimer: NodeJS.Timeout
    const bumpIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(new Error(`[docker] export idle for ${EXPORT_IDLE_TIMEOUT_MS / 60_000}min — killing process`))
      }, EXPORT_IDLE_TIMEOUT_MS)
    }
    bumpIdle()

    const hardTimer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('[docker] export exceeded the maximum runtime — killing process'))
    }, EXPORT_MAX_MS)

    const clearTimers = () => { clearTimeout(idleTimer); clearTimeout(hardTimer) }

    proc.stdout.on('data', (chunk: Buffer) => {
      bumpIdle()
      chunk.toString().split('\n').filter(Boolean).forEach((l) => {
        stdoutBuf.push(l)
        console.log(`[dce]   ${l}`)
      })
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      bumpIdle()
      chunk.toString().split('\n').filter(Boolean).forEach((l) => {
        stderrBuf.push(l)
        console.error(`[dce:err]  ${l}`)
      })
    })

    proc.on('close', (code) => {
      clearTimers()
      console.log(`[docker] Process exited with code ${code}`)
      if (code !== 0) {
        const msg = ([...stderrBuf.lines(), ...stdoutBuf.lines()].join('\n').trim() || `docker exited ${code}`)
          .split('\n').slice(0, 5).join(' | ')
        console.error(`[docker] FAILED: ${msg}`)
        reject(new Error(msg))
        return
      }

      let outputPath = hostOutDir
      try {
        const files = fs.readdirSync(hostOutDir)
          .map((f) => ({ f, mtime: fs.statSync(path.join(hostOutDir, f)).mtime.getTime() }))
          .sort((a, b) => b.mtime - a.mtime)
        if (files.length > 0) outputPath = path.join(hostOutDir, files[0].f)
      } catch (err) { console.warn('[docker] Could not determine output file:', err) }

      // DCE does not print a total, so read it off the export instead. The Json
      // writer puts "messageCount" in the trailing object, hence the tail read.
      const messageCount = readMessageCount(outputPath)
      let bytes = 0
      try { bytes = fs.statSync(outputPath).size } catch { /* directory fallback */ }

      console.log(`[docker] SUCCESS — ${messageCount} messages → ${outputPath}`)
      console.log(`[docker] ────────────────────────────────────────────────`)
      resolve({ messageCount, outputPath, bytes })
    })

    proc.on('error', (err) => {
      clearTimers()
      console.error(`[docker] spawn error: ${err.message}`)
      reject(new Error(`Failed to spawn docker: ${err.message}`))
    })
  })
}
