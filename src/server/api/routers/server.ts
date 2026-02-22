import { router, publicProcedure } from '../trpc'
import { z } from 'zod'
import { db } from '@/lib/db'

export const serverRouter = router({
  list: publicProcedure.query(async () => {
    return db.server.findMany({
      include: { channels: true },
    })
  }),

  add: publicProcedure
    .input(
      z.object({
        name: z.string(),
        discordId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return db.server.create({
        data: input,
      })
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return db.server.update({
        where: { id: input.id },
        data: { name: input.name },
      })
    }),

  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return db.server.delete({
        where: { id: input.id },
      })
    }),
})
