/**
 * Heuristic "is this message a generation prompt?" scoring.
 *
 * There is no clean signal for this — people post prompts with a `Prompt:`
 * label, inside code fences, or as a bare paragraph under a video. So we score
 * a few independent signals and threshold. Score is 0-100; >= 50 counts.
 */

export interface PromptResult {
  score: number
  isPrompt: boolean
  /** The prompt body when we could isolate it, else null (use `content`). */
  promptText: string | null
  negativePrompt: string | null
}

const RE_LABELLED = /(?:^|\n)\s*(?:positive\s+)?prompt\s*[:=]\s*([\s\S]*?)(?=\n\s*(?:negative|neg)\s*(?:prompt)?\s*[:=]|\n\s*[a-z ]{3,20}\s*[:=]|$)/i
const RE_NEGATIVE = /(?:^|\n)\s*(?:negative|neg)\s*(?:prompt)?\s*[:=]\s*([\s\S]*?)(?=\n\s*[a-z ]{3,20}\s*[:=]|$)/i
const RE_FENCE = /```(?:[a-z]*\n)?([\s\S]*?)```/
const RE_URL = /https?:\/\/\S+/g
const RE_CODEY = /[{};]\s*$|^\s*(?:import|def |class |const |function |\{)|"[a-z_]+"\s*:/im
const RE_QUESTION = /^\s*(?:how|what|why|when|where|which|who|can|does|do|is|are|any(?:one|body)|has)\b/i

/** Words that show up in descriptive video prompts far more than in chat. */
const CINEMATIC = /\b(?:camera|cinematic|close[- ]?up|wide shot|tracking shot|dolly|pan(?:ning)?|zoom|lighting|golden hour|bokeh|shallow depth|slow motion|4k|8k|hyper ?realistic|photorealistic|render|aesthetic|film grain|lens|shot on|backlit|silhouette|motion blur)\b/gi

export function detectPrompt(content: string, hasMedia: boolean): PromptResult {
  const text = content.trim()
  if (text.length < 40) {
    return { score: 0, isPrompt: false, promptText: null, negativePrompt: null }
  }

  const negMatch = text.match(RE_NEGATIVE)
  const negativePrompt = negMatch ? negMatch[1].trim().slice(0, 2000) || null : null

  let score = 0
  let promptText: string | null = null

  const labelled = text.match(RE_LABELLED)
  if (labelled && labelled[1].trim().length > 15) {
    score += 70
    promptText = labelled[1].trim()
  }
  if (negativePrompt) score += 25

  const fenced = text.match(RE_FENCE)
  if (fenced && fenced[1].trim().length > 40 && !RE_CODEY.test(fenced[1])) {
    score += 30
    promptText ??= fenced[1].trim()
  }

  const body = promptText ?? text
  const words = body.split(/\s+/).filter(Boolean).length
  const urls = (text.match(RE_URL) ?? []).length
  const cinematic = (body.match(CINEMATIC) ?? []).length

  // A long, comma-heavy descriptive paragraph is the classic bare prompt.
  if (words >= 25 && body.length >= 180) score += 20
  if (words >= 60) score += 10
  if (cinematic >= 1) score += 15
  if (cinematic >= 3) score += 15
  if (hasMedia && words >= 20) score += 20

  // Penalties — chatter, link dumps, code, questions.
  if (urls > 0 && text.replace(RE_URL, '').trim().length < 60) score -= 60
  if (RE_CODEY.test(text) && !labelled) score -= 30
  if (RE_QUESTION.test(text) || text.trimEnd().endsWith('?')) score -= 35
  if (words < 15) score -= 40

  score = Math.max(0, Math.min(100, score))

  return {
    score,
    isPrompt: score >= 50,
    promptText: promptText ? promptText.slice(0, 4000) : null,
    negativePrompt,
  }
}
