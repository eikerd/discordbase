import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import { z } from 'zod'
import path from 'path'
import fs from 'fs'
import { db } from '@/lib/db'
import { runChannelExport, ensureImage, checkDockerAvailable, getChannelOutputDir } from '@/lib/docker'

/** Past this, a job still marked running is wreckage from a crashed process:
 *  docker-core caps an export at 12h, so nothing legitimate reaches 13. */
const STALE_JOB_MS = 13 * 60 * 60_000
const COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

export const jobRouter = router({
  recent: publicProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return db.scrapeJob.findMany({
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        include: { channel: { include: { server: true } } },
      })
    }),

  /** Full sync history for the SYNC LOG tab, newest first. */
  log: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        status: z.enum(['all', 'done', 'failed', 'running', 'partial']).default('all'),
      }),
    )
    .query(async ({ input }) => {
      const where = input.status === 'all' ? {} : { status: input.status }

      const [jobs, total, agg] = await Promise.all([
        db.scrapeJob.findMany({
          where,
          take: input.limit,
          skip: input.offset,
          orderBy: { createdAt: 'desc' },
          include: { channel: { include: { server: true } } },
        }),
        db.scrapeJob.count({ where }),
        db.scrapeJob.aggregate({
          where: { status: 'done' },
          _sum: { messageCount: true, exportBytes: true, ingestedCount: true, promptCount: true },
          _count: true,
        }),
      ])

      return {
        jobs,
        total,
        summary: {
          completed: agg._count,
          messages: agg._sum.messageCount ?? 0,
          ingested: agg._sum.ingestedCount ?? 0,
          prompts: agg._sum.promptCount ?? 0,
          bytes: agg._sum.exportBytes ?? 0,
        },
      }
    }),

  byChannel: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ input }) => {
      return db.scrapeJob.findMany({
        where: { channelId: input.channelId },
        orderBy: { createdAt: 'desc' },
      })
    }),

  triggerScrape: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .mutation(async ({ input }) => {
      console.log(`[job] triggerScrape called for channelId=${input.channelId}`)

      // Check Docker first
      const dockerOk = await checkDockerAvailable()
      if (!dockerOk) {
        console.error('[job] Docker daemon is not running')
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Docker is not running. Start Docker Desktop and try again.',
        })
      }

      // Load channel + server
      const channel = await db.channel.findUnique({
        where: { id: input.channelId },
        include: { server: true },
      })
      if (!channel) {
        console.error(`[job] Channel not found: ${input.channelId}`)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' })
      }
      console.log(`[job] Channel: #${channel.name} (discordId=${channel.discordId}) in server "${channel.server.name}"`)

      // 24h cooldown check
      if (channel.lastScraped) {
        const elapsed = Date.now() - channel.lastScraped.getTime()
        if (elapsed < COOLDOWN_MS) {
          console.warn(`[job] Channel ${input.channelId} scraped ${Math.round(elapsed / 60000)}min ago — cooldown active`)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Channel was scraped less than 24 hours ago',
          })
        }
      }

      // A job whose process died without reaching its catch stays 'running'
      // forever, and the guard below would then refuse this channel for good.
      // docker-core caps an export at 12h, so past 13 it is wreckage: mark it
      // failed and let the scan proceed.
      const staleCutoff = new Date(Date.now() - STALE_JOB_MS)
      const reclaimed = await db.scrapeJob.updateMany({
        where: {
          channelId: input.channelId,
          status: 'running',
          OR: [{ startedAt: { lt: staleCutoff } }, { startedAt: null, createdAt: { lt: staleCutoff } }],
        },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorLog: 'Reclaimed: still marked running with no process to finish it.',
        },
      })
      if (reclaimed.count > 0) {
        console.warn(`[job] Reclaimed ${reclaimed.count} stale running job(s) for channel ${input.channelId}`)
      }

      // Concurrent scrape guard
      const running = await db.scrapeJob.findFirst({
        where: { channelId: input.channelId, status: 'running' },
      })
      if (running) {
        console.warn(`[job] Channel ${input.channelId} already has a running job id=${running.id}`)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A scrape job is already running for this channel',
        })
      }

      // Load config / token
      const config = await db.appConfig.findUnique({ where: { id: 'singleton' } })
      if (!config?.discordToken) {
        console.error('[job] No Discord token configured — aborting')
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Discord token not set. Go to Settings and save your token first.',
        })
      }
      console.log(`[job] Config loaded — format=${config.exportFormat} outputDir=${config.outputDir}`)

      // Create job record
      const job = await db.scrapeJob.create({
        data: { channelId: input.channelId, status: 'running', startedAt: new Date() },
      })
      console.log(`[job] Created job record id=${job.id} status=running`)

      try {
        // Ensure image is pulled
        await ensureImage()

        // Run the export
        const result = await runChannelExport({
          token: config.discordToken,
          channelDiscordId: channel.discordId,
          serverName: channel.server.name,
          channelName: channel.name,
          format: config.exportFormat,
          outputDir: config.outputDir,
        })

        // Mark job done
        const done = await db.scrapeJob.update({
          where: { id: job.id },
          data: {
            status: 'done',
            finishedAt: new Date(),
            messageCount: result.messageCount,
            outputPath: result.outputPath,
          },
        })
        console.log(`[job] Job ${job.id} marked DONE — ${result.messageCount} messages`)

        // Update channel lastScraped
        await db.channel.update({
          where: { id: input.channelId },
          data: { lastScraped: new Date() },
        })
        console.log(`[job] Channel lastScraped updated`)

        return done
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`[job] Job ${job.id} FAILED: ${errorMsg}`)

        // Persist full error in job record for debugging
        await db.scrapeJob.update({
          where: { id: job.id },
          data: { status: 'failed', finishedAt: new Date(), errorLog: errorMsg },
        })

        // Return generic message to client — full details are in server logs and job.errorLog
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Export failed — check server logs',
        })
      }
    }),

  // Returns total bytes written to the channel's output directory.
  // Called every 5 s by the client during an active scan to power the progress indicator.
  scanProgress: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ input }) => {
      const channel = await db.channel.findUnique({
        where: { id: input.channelId },
        include: { server: true },
      })
      if (!channel) return { bytes: 0 }

      const config = await db.appConfig.findUnique({ where: { id: 'singleton' } })
      const outputDir = config?.outputDir ?? './exports'

      const dir = getChannelOutputDir({
        serverName: channel.server.name,
        channelName: channel.name,
        outputDir,
      })

      try {
        const files = fs.readdirSync(dir)
        const bytes = files.reduce((sum, f) => {
          try { return sum + fs.statSync(path.join(dir, f)).size } catch { return sum }
        }, 0)
        return { bytes }
      } catch {
        return { bytes: 0 }
      }
    }),

  triggerServer: publicProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ input }) => {
      const channels = await db.channel.findMany({
        where: { serverId: input.serverId },
      })
      console.log(`[job] triggerServer: queueing ${channels.length} channels for serverId=${input.serverId}`)
      // TODO: Jobs are created with status 'pending' so the scheduler can pick them up
      // in a future sprint. The scheduler (node-cron) will poll for pending jobs and
      // execute them sequentially — one docker run at a time.
      return Promise.all(
        channels.map((ch) =>
          db.scrapeJob.create({
            data: { channelId: ch.id, status: 'pending' },
          })
        )
      )
    }),

  triggerAllDue: publicProcedure.mutation(async () => {
    return { queued: 0 }
  }),
})
