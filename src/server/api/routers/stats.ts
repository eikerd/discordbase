import { router, publicProcedure } from '../trpc'
import { db } from '@/lib/db'
import { checkDockerAvailable } from '@/lib/docker'

export const statsRouter = router({
  dashboard: publicProcedure.query(async () => {
    const [serverCount, channelCount, jobCount, totalMessages, dockerRunning] =
      await Promise.all([
        db.server.count(),
        db.channel.count(),
        db.scrapeJob.count(),
        db.scrapeJob.aggregate({ _sum: { messageCount: true } }),
        checkDockerAvailable(),
      ])

    return {
      servers: serverCount,
      channels: channelCount,
      jobsRun: jobCount,
      totalMessages: totalMessages._sum.messageCount || 0,
      dockerRunning,
    }
  }),
})
