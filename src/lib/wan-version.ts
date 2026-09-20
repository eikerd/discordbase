/**
 * Wan model-version attribution.
 *
 * The whole point of this archive is telling a Wan 3.0 prompt apart from a 2.7
 * prompt. Channel names are NOT a reliable label — sampling #wan26 in the
 * official server turned up more talk about 2.7 than about 2.6 — so version is
 * detected from the message text first and only falls back to the channel.
 *
 * Every detection carries a source so the UI can show how much to trust it.
 */

/** Versions we accept. Guards against matching "1.3B", prices, timestamps, etc. */
export const KNOWN_VERSIONS = ['2.1', '2.2', '2.5', '2.6', '2.7', '3.0'] as const
export type WanVersion = (typeof KNOWN_VERSIONS)[number]

/** Ordered strongest → weakest. The UI renders these as confidence. */
export const VERSION_SOURCES = ['model_id', 'explicit', 'contextual', 'channel'] as const
export type VersionSource = (typeof VERSION_SOURCES)[number]

export type WanTask = 't2v' | 'i2v' | 'ti2v' | 's2v' | 'flf2v' | 'animate' | 'vace'

export interface VersionHit {
  version: WanVersion
  source: VersionSource
  task?: WanTask
}

export interface VersionResult {
  /** Best single guess, or null when nothing was detected. */
  version: WanVersion | null
  source: VersionSource | null
  task: WanTask | null
  /** Every version seen in the message, most-mentioned first. */
  all: WanVersion[]
}

const isKnown = (v: string): v is WanVersion =>
  (KNOWN_VERSIONS as readonly string[]).includes(v)

/** "22" -> "2.2", "3" -> "3.0", "2.7" -> "2.7" */
function normalize(raw: string): string | null {
  const s = raw.replace(/[\s_-]/g, '')
  if (/^\d\.\d$/.test(s)) return s
  if (/^\d\d$/.test(s)) return `${s[0]}.${s[1]}`
  if (/^\d$/.test(s)) return `${s}.0`
  return null
}

const TASK_WORDS = 't2v|i2v|ti2v|s2v|flf2v|animate|vace'

/**
 * Tier 1 — a real model identifier: "Wan2.2-I2V-A14B", "wan2.1_t2v_14b_fp8.safetensors".
 * Unambiguous, so it also gives us the task.
 */
const RE_MODEL_ID = new RegExp(
  String.raw`\bwan[\s._-]*(\d(?:[._]\d)?)[\s._-]*(${TASK_WORDS})\b`,
  'gi',
)

/** Tier 2 — the word "wan" bound to a version: "Wan 3.0", "wan2.2", "wan27", "WAN v2.6". */
const RE_EXPLICIT = new RegExp(String.raw`\bwan[\s._-]*v?(\d\.\d|\d\d|\d)\b`, 'gi')

/**
 * Tier 3 — a bare version in a message that is already talking about Wan.
 * Deliberately narrow: requires the x.y form, and rejects a following "b" so
 * parameter counts like "1.3B" / "14B" never register as versions.
 */
const RE_CONTEXTUAL = /(?:^|[^\w.])v?(\d\.\d)(?![.\d])(?!\s*b\b)/gi

/** Does this message look like it is about Wan at all? Gates tier 3. */
const RE_WAN_CONTEXT = /\bwan\b|\bwangp\b|\bcomfy|\bt2v\b|\bi2v\b|\bvace\b/i

export interface DetectOptions {
  channelName?: string
  /**
   * Fall back to labelling by channel name when the text says nothing.
   * Off by default and it should stay off for anything the UI counts:
   * sampling the official server showed #wan26 discussing 2.7 more than 2.6,
   * so the channel name is a topic, not a label. Turning this on makes every
   * quiet message in a versioned channel claim that version.
   */
  useChannelFallback?: boolean
}

export function detectVersions(text: string, opts: DetectOptions = {}): VersionResult {
  const { channelName, useChannelFallback = false } = opts
  const hits: VersionHit[] = []

  for (const m of text.matchAll(RE_MODEL_ID)) {
    const v = normalize(m[1])
    if (v && isKnown(v)) {
      hits.push({ version: v, source: 'model_id', task: m[2].toLowerCase() as WanTask })
    }
  }

  for (const m of text.matchAll(RE_EXPLICIT)) {
    const v = normalize(m[1])
    if (v && isKnown(v)) hits.push({ version: v, source: 'explicit' })
  }

  // A versioned channel is itself Wan context, so bare "2.7" counts there.
  if (RE_WAN_CONTEXT.test(text) || /wan/i.test(channelName ?? '')) {
    for (const m of text.matchAll(RE_CONTEXTUAL)) {
      const v = normalize(m[1])
      if (v && isKnown(v)) hits.push({ version: v, source: 'contextual' })
    }
  }

  if (hits.length === 0) {
    const fromChannel = useChannelFallback && channelName ? versionFromChannelName(channelName) : null
    if (fromChannel) {
      return { version: fromChannel, source: 'channel', task: null, all: [fromChannel] }
    }
    return { version: null, source: null, task: null, all: [] }
  }

  // Rank by source strength, then by how often the version appears.
  const counts = new Map<WanVersion, number>()
  for (const h of hits) counts.set(h.version, (counts.get(h.version) ?? 0) + 1)

  const strength = (s: VersionSource) => VERSION_SOURCES.indexOf(s)
  const best = hits.reduce((a, b) => {
    const ds = strength(a.source) - strength(b.source)
    if (ds !== 0) return ds < 0 ? a : b
    return (counts.get(a.version) ?? 0) >= (counts.get(b.version) ?? 0) ? a : b
  })

  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
  const task = hits.find((h) => h.version === best.version && h.task)?.task ?? null

  return { version: best.version, source: best.source, task, all }
}

/** "wan25-preview" -> "2.5", "wan22-animate-anything" -> "2.2". Weakest signal. */
export function versionFromChannelName(name: string): WanVersion | null {
  const m = name.match(/wan[\s._-]*(\d\.\d|\d\d)\b/i)
  if (!m) return null
  const v = normalize(m[1])
  return v && isKnown(v) ? v : null
}
