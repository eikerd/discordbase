import { router, publicProcedure } from '../trpc'
import { z } from 'zod'
import { db } from '@/lib/db'
import { checkDockerAvailable } from '@/lib/docker'

export const configRouter = router({
  get: publicProcedure.query(async () => {
    let config = await db.appConfig.findUnique({
      where: { id: 'singleton' },
    })
    if (!config) {
      config = await db.appConfig.create({
        data: { id: 'singleton' },
      })
    }
    return config
  }),

  update: publicProcedure
    .input(
      z.object({
        discordToken: z.string().optional(),
        exportFormat: z.string().optional(),
        outputDir: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return db.appConfig.upsert({
        where: { id: 'singleton' },
        update: input,
        create: { id: 'singleton', ...input },
      })
    }),

  validateToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      // TODO: Implement Docker token validation
      return { valid: true }
    }),

  checkDocker: publicProcedure.query(async () => {
    const running = await checkDockerAvailable()
    return { running }
  }),

  pullImage: publicProcedure.mutation(async () => {
    // TODO: Implement Docker image pull
    return { success: true }
  }),
})
