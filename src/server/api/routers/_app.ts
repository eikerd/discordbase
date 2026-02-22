import { router } from '../trpc'
import { configRouter } from './config'
import { serverRouter } from './server'
import { channelRouter } from './channel'
import { jobRouter } from './job'
import { statsRouter } from './stats'

export const appRouter = router({
  config: configRouter,
  server: serverRouter,
  channel: channelRouter,
  job: jobRouter,
  stats: statsRouter,
})

export type AppRouter = typeof appRouter
