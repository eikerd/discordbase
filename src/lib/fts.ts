/**
 * FTS5 index over Message.
 *
 * `message_fts` is an external-content table: it stores only the inverted index
 * and reads the actual text back out of `Message` via rowid. That works because
 * Message.seq is an INTEGER PRIMARY KEY, which SQLite aliases to rowid.
 *
 * Kept as raw SQL because Prisma has no concept of virtual tables — it would
 * drop them on the next `db push` if they were in the schema.
 */

export const FTS_TABLE = 'message_fts'

export const FTS_DDL: string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
     content,
     authorName,
     content='Message',
     content_rowid='seq',
     tokenize="unicode61 remove_diacritics 2"
   )`,
  `CREATE TRIGGER IF NOT EXISTS message_fts_ai AFTER INSERT ON Message BEGIN
     INSERT INTO message_fts(rowid, content, authorName)
     VALUES (new.seq, new.content, new.authorName);
   END`,
  `CREATE TRIGGER IF NOT EXISTS message_fts_ad AFTER DELETE ON Message BEGIN
     INSERT INTO message_fts(message_fts, rowid, content, authorName)
     VALUES ('delete', old.seq, old.content, old.authorName);
   END`,
  `CREATE TRIGGER IF NOT EXISTS message_fts_au AFTER UPDATE ON Message BEGIN
     INSERT INTO message_fts(message_fts, rowid, content, authorName)
     VALUES ('delete', old.seq, old.content, old.authorName);
     INSERT INTO message_fts(rowid, content, authorName)
     VALUES (new.seq, new.content, new.authorName);
   END`,
]

export const FTS_REBUILD = `INSERT INTO message_fts(message_fts) VALUES('rebuild')`

/**
 * Tear the index down before `prisma db push`.
 *
 * Order matters: push drops message_fts but leaves the triggers behind, and the
 * orphaned triggers then fire while push rebuilds Message and abort the whole
 * migration with "no such table: main.message_fts". Triggers go first.
 */
export const FTS_DROP: string[] = [
  'DROP TRIGGER IF EXISTS message_fts_ai',
  'DROP TRIGGER IF EXISTS message_fts_ad',
  'DROP TRIGGER IF EXISTS message_fts_au',
  'DROP TABLE IF EXISTS message_fts',
]

/**
 * Turn whatever the user typed into a valid FTS5 MATCH expression.
 *
 * FTS5 throws on unbalanced quotes and on bare operators, and a thrown query is
 * a broken search box. So: keep "quoted phrases" and trailing* wildcards, quote
 * every other token so punctuation can't be read as syntax, and AND them.
 * Bare AND / OR / NOT are passed through so power users keep boolean search.
 */
export function toFtsQuery(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const tokens: string[] = []
  // "quoted phrase" | word* | word
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null

  while ((m = re.exec(trimmed)) !== null) {
    if (m[1] !== undefined) {
      const phrase = m[1].replace(/"/g, '').trim()
      if (phrase) tokens.push(`"${phrase}"`)
      continue
    }
    const word = m[2]
    if (/^(AND|OR|NOT)$/.test(word)) {
      tokens.push(word)
      continue
    }
    const prefix = word.endsWith('*')
    const bare = word.replace(/\*+$/, '').replace(/"/g, '')
    // Strip characters FTS5 treats as syntax; unicode61 splits on them anyway.
    const safe = bare.replace(/[()^:{}[\]]/g, ' ').trim()
    if (!safe) continue
    tokens.push(prefix ? `"${safe}"*` : `"${safe}"`)
  }

  if (tokens.length === 0) return null

  // Join with AND, but never leave a dangling/duplicated operator.
  const out: string[] = []
  for (const t of tokens) {
    const isOp = /^(AND|OR|NOT)$/.test(t)
    const prevOp = out.length === 0 || /^(AND|OR|NOT)$/.test(out[out.length - 1])
    if (isOp && prevOp) continue
    if (!isOp && !prevOp) out.push('AND')
    out.push(t)
  }
  while (out.length && /^(AND|OR|NOT)$/.test(out[out.length - 1])) out.pop()

  return out.length ? out.join(' ') : null
}
