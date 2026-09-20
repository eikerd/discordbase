import { TRPCError } from '@trpc/server'
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
      if (input.outputDir !== undefined) {
        const dir = input.outputDir.trim()
        // A Windows drive letter is absolute too, and "C:foo" is drive-relative —
        // neither belongs under the app root.
        if (dir.startsWith('/') || dir.startsWith('\\') || /^[a-zA-Z]:/.test(dir)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'outputDir must be a relative path, not an absolute path',
          })
        }
        // Check the decoded form as well: "%2e%2e/" survives a plain includes("..").
        // decodeURIComponent throws on a malformed sequence, which is itself a reason
        // to refuse the value rather than store something we cannot reason about.
        let decoded = dir
        try {
          decoded = decodeURIComponent(dir)
        } catch {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'outputDir contains an invalid percent-encoded sequence',
          })
        }
        if (dir.includes('..') || decoded.includes('..')) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'outputDir must not contain ".." path traversal segments',
          })
        }
      }

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
