import { spawn, execFileSync } from 'child_process'
import path from 'path'
import fs from 'fs'

const IMAGE = 'tyrrrz/discordchatexporter:stable'

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
      execFileSync(bin, ['--version'], { stdio: 'ignore' })
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
}

export async function checkDockerAvailable(): Promise<boolean> {
  console.log('[docker] Checking Docker daemon...')
  try {
    const bin = dockerBin()
    return await new Promise((resolve) => {
      const proc = spawn(bin, ['info'], { stdio: 'ignore' })
      proc.on('close', (code) => {
        console.log(`[docker] daemon check exit code: ${code}`)
        resolve(code === 0)
      })
      proc.on('error', (err) => {
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

  const present = await new Promise<boolean>((resolve) => {
    const check = spawn(bin, ['image', 'inspect', IMAGE], { stdio: 'ignore' })
    check.on('close', (code) => resolve(code === 0))
    check.on('error', () => resolve(false))
  })

  if (present) {
    console.log(`[docker] Image already present — skip pull`)
    return
  }

  console.log(`[docker] Pulling ${IMAGE} ...`)
  await new Promise<void>((resolve, reject) => {
    const pull = spawn(bin, ['pull', IMAGE])
    pull.stdout.on('data', (d: Buffer) =>
      d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`[docker:pull]  ${l}`))
    )
    pull.stderr.on('data', (d: Buffer) =>
      d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`[docker:pull]  ${l}`))
    )
    pull.on('close', (code) => {
      if (code === 0) { console.log('[docker] Pull complete'); resolve() }
      else reject(new Error(`docker pull exited with code ${code}`))
    })
    pull.on('error', reject)
  })
}

export async function runChannelExport(opts: {
  token: string
  channelDiscordId: string
  serverName: string
  channelName: string
  format: string
  outputDir: string
}): Promise<ExportResult> {
  const { token, channelDiscordId, serverName, channelName, format, outputDir } = opts
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
  console.log(`[docker]   Docker bin  : ${bin}`)

  fs.mkdirSync(hostOutDir, { recursive: true })

  const args = [
    'run', '--rm',
    '-v', `${hostOutDir}:/app/out`,
    IMAGE,
    'export',
    '--token', token,
    '--channel', channelDiscordId,
    '--format', format,
    '--output', '/app/out/',
  ]

  // Log args with token redacted
  const safeArgs = args.map((a, i) => (args[i - 1] === '--token' ? '***' : a))
  console.log(`[docker] CMD: ${bin} ${safeArgs.join(' ')}`)

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      text.split('\n').filter(Boolean).forEach((l) => console.log(`[dce]   ${l}`))
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      text.split('\n').filter(Boolean).forEach((l) => console.error(`[dce:err]  ${l}`))
    })

    proc.on('close', (code) => {
      console.log(`[docker] Process exited with code ${code}`)
      if (code !== 0) {
        const msg = (stderr.trim() || stdout.trim() || `docker exited ${code}`)
          .split('\n').slice(0, 5).join(' | ')
        console.error(`[docker] FAILED: ${msg}`)
        reject(new Error(msg))
        return
      }

      const combined = stdout + stderr
      const countMatch = combined.match(/(\d[\d,]+)\s+message/i)
      const messageCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : 0

      let outputPath = hostOutDir
      try {
        const files = fs.readdirSync(hostOutDir)
          .map((f) => ({ f, mtime: fs.statSync(path.join(hostOutDir, f)).mtime.getTime() }))
          .sort((a, b) => b.mtime - a.mtime)
        if (files.length > 0) outputPath = path.join(hostOutDir, files[0].f)
      } catch (_) {}

      console.log(`[docker] SUCCESS — ${messageCount} messages → ${outputPath}`)
      console.log(`[docker] ────────────────────────────────────────────────`)
      resolve({ messageCount, outputPath })
    })

    proc.on('error', (err) => {
      console.error(`[docker] spawn error: ${err.message}`)
      reject(new Error(`Failed to spawn docker: ${err.message}`))
    })
  })
}
