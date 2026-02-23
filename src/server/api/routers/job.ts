import { router, publicProcedure } from '../trpc'
import { z } from 'zod'
import { db } from '@/lib/db'

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
      // TODO: Implement scrape trigger
      return db.scrapeJob.create({
        data: {
          channelId: input.channelId,
          status: 'pending',
        },
      })
    }),

  triggerServer: publicProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ input }) => {
      // TODO: Implement server scrape trigger
      const channels = await db.channel.findMany({
        where: { serverId: input.serverId },
      })
      return Promise.all(
        channels.map((ch) =>
          db.scrapeJob.create({
            data: { channelId: ch.id, status: 'pending' },
          })
        )
      )
    }),

  triggerAllDue: publicProcedure.mutation(async () => {
    // TODO: Implement all-due scrape trigger
    return { queued: 0 }
  }),
})
