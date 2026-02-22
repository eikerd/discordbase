import { router, publicProcedure } from '../trpc'
import { z } from 'zod'
import { db } from '@/lib/db'

export const channelRouter = router({
  listByServer: publicProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ input }) => {
      return db.channel.findMany({
        where: { serverId: input.serverId },
      })
    }),

  add: publicProcedure
    .input(
      z.object({
        serverId: z.string(),
        name: z.string(),
        discordId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return db.channel.create({
        data: input,
      })
    }),

  toggleEnabled: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const channel = await db.channel.findUnique({
        where: { id: input.id },
      })
      return db.channel.update({
        where: { id: input.id },
        data: { enabled: !channel?.enabled },
      })
    }),

  updateInterval: publicProcedure
    .input(
      z.object({
        id: z.string(),
        scrapeEvery: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return db.channel.update({
        where: { id: input.id },
        data: { scrapeEvery: input.scrapeEvery },
      })
    }),

  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return db.channel.delete({
        where: { id: input.id },
      })
    }),
})
