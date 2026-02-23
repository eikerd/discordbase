import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import { z } from 'zod'
import { db } from '@/lib/db'
import { runChannelExport, ensureImage, checkDockerAvailable } from '@/lib/docker'

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

        await db.scrapeJob.update({
          where: { id: job.id },
          data: { status: 'failed', finishedAt: new Date(), errorLog: errorMsg },
        })

        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: errorMsg })
      }
    }),

  triggerServer: publicProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ input }) => {
      const channels = await db.channel.findMany({
        where: { serverId: input.serverId },
      })
      console.log(`[job] triggerServer: queueing ${channels.length} channels for serverId=${input.serverId}`)
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
