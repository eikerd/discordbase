import 'server-only'

/**
 * Server-only facade. Every Docker interaction in the app goes through this
 * module; the implementation lives in ./docker-core so `scripts/scrape-next.ts`
 * can reuse it outside the Next runtime.
 */
export * from './docker-core'
