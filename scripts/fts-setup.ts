#!/usr/bin/env bun
/**
 * Recreate and repopulate the FTS5 index.
 *
 * Prisma has no concept of virtual tables, so `prisma db push` sees message_fts
 * as a stray table and drops it — every single time. That is survivable because
 * the index is derived data: Message is the source of truth and the index can
 * be rebuilt from it. Run this after any push. `bun run db:push` does both.
 */

import { Database } from 'bun:sqlite'
import { resolve } from 'node:path'
import { FTS_DDL, FTS_DROP, FTS_REBUILD } from '../src/lib/fts'

const db = new Database(resolve(process.cwd(), 'prisma/prisma/dev.db'))
db.run('PRAGMA journal_mode = WAL')

// `--drop` runs before a push: it removes the triggers that would otherwise be
// left pointing at a table push is about to delete.
if (process.argv.includes('--drop')) {
  for (const sql of FTS_DROP) db.run(sql)
  console.log('message_fts and its triggers dropped — rebuild after the push')
  db.close()
  process.exit(0)
}

for (const ddl of FTS_DDL) db.run(ddl)
db.run(FTS_REBUILD)

const messages = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM Message').get()!.n
const indexed = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM message_fts').get()!.n

console.log(`message_fts rebuilt — ${indexed.toLocaleString()} of ${messages.toLocaleString()} messages indexed`)
if (indexed !== messages) {
  console.error('index and table disagree — that should not happen')
  process.exit(1)
}
db.close()
