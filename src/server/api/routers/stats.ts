import { router, publicProcedure } from '../trpc'
import { db } from '@/lib/db'
import { checkDockerAvailable } from '@/lib/docker'

export const statsRouter = router({
  dashboard: publicProcedure.query(async () => {
    const serverCount = await db.server.count()
    const channelCount = await db.channel.count()
    const jobCount = await db.scrapeJob.count()
    const totalMessages = await db.scrapeJob.aggregate({
      _sum: { messageCount: true },
    })

    const dockerRunning = await checkDockerAvailable()

    return {
      servers: serverCount,
      channels: channelCount,
      jobsRun: jobCount,
      totalMessages: totalMessages._sum.messageCount || 0,
      dockerRunning,
    }
  }),
})
