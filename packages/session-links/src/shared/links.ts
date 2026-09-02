/**
 * Pure link extraction and classification for the session-links panel.
 *
 * Everything in this module is side-effect free and framework free so the
 * behavior is locked by unit tests. The categorization rule table lives here
 * in one place — extend it, keep tests in sync.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

/** Categories a collected URL can land in. */
export type LinkCategory = 'mr' | 'deploy' | 'meego' | 'artifact' | 'other'

/** Message role that produced a link (drives the assistant-first ordering). */
export type LinkRole = 'user' | 'assistant' | 'steering' | 'context' | 'other'

/** One collected link occurrence, as projected for display. */
export interface LinkEntry {
  /** The cleaned URL. */
  url: string
  /** Classification result. */
  category: LinkCategory
  /** Unix epoch ms of the message that last carried this URL. */
  time: number
  /** `seq` of the message that last carried this URL (monotonic order key). */
  seq: number
  /** Role of the message that last carried this URL. */
  role: LinkRole
  /** Readable title: host plus a truncated path summary. */
  title: string
  /** How many times this URL appeared (dedup keeps the latest occurrence). */
  count: number
}

/** Display label for each category, in the panel's fixed group order. */
export const CATEGORY_LABELS: Readonly<Record<LinkCategory, string>> = {
  mr: 'MR',
  deploy: '部署',
  meego: 'Meego',
  artifact: '产物制品',
  other: '其他',
}

export const CATEGORY_ORDER: readonly LinkCategory[] = ['mr', 'deploy', 'meego', 'artifact', 'other']

/** Role -> sort precedence; assistant always outranks the rest at equal time. */
const ROLE_RANK: Readonly<Record<LinkRole, number>> = {
  assistant: 0,
  context: 1,
  steering: 2,
  user: 3,
  other: 4,
}

/* ------------------------------------------------------------------ */
/* URL extraction                                                      */
/* ------------------------------------------------------------------ */

/** Markdown destination: `[label](https://...)` — capture the URL group. */
const MD_LINK_RE = /\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g
/** Bare URL token: everything up to whitespace, enclosing quotes/brackets,
 *  or CJK text (Chinese characters and full-width punctuation terminate the
 *  token so prose like `x,谢谢` keeps the URL `x`). */
const RAW_URL_RE = /https?:\/\/[^\s"'<>`\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g

/** Tail punctuation stripped from a raw URL token (Unicode quotes included). */
const TAIL_PUNCT = new Set(['.', ',', ';', ':', '!', '?', '，', '。', '；', '：', '！', '？', '、', "'", '"', '`', '’', '“', '”', '」', '』', '》', '】', '）'])

function countOf(s: string, ch: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++
  return n
}

/**
 * Strip trailing punctuation from a URL token, keeping balanced `)`/`]`/`}`
 * (a closing bracket is only stripped when it is unbalanced, so real URL
 * parens survive).
 */
export function stripUrlTail(raw: string): string {
  let s = raw.trim()
  for (;;) {
    const last = s[s.length - 1]
    if (last === undefined) break
    if (last === ')' || last === ']' || last === '}') {
      const open = last === ')' ? '(' : last === ']' ? '[' : '{'
      if (countOf(s, last) > countOf(s, open)) {
        s = s.slice(0, -1)
        continue
      }
      break // balanced — a real part of the URL
    }
    if (TAIL_PUNCT.has(last)) {
      s = s.slice(0, -1)
      continue
    }
    break
  }
  return s
}

/** The minimum length a stripped URL must keep ('https://x'). */
const MIN_URL_LENGTH = 'https://'.length + 1

/**
 * Extract normalized, deduplicated URLs from one text blob. Markdown link
 * destinations are taken verbatim; bare tokens are tail-cleaned. The same
 * URL found twice (markdown + raw pass) yields one result.
 */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string): void => {
    const url = stripUrlTail(raw)
    if (url.length < MIN_URL_LENGTH) return
    if (seen.has(url)) return
    seen.add(url)
    out.push(url)
  }
  const md = new RegExp(MD_LINK_RE.source, 'g')
  for (const m of text.matchAll(md)) {
    const g = m[2]
    if (g) push(g)
  }
  const raw = new RegExp(RAW_URL_RE.source, 'g')
  for (const m of text.matchAll(raw)) push(m[0])
  return out
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

/** One rule: category + a predicate over the parsed URL parts. */
interface CategoryRule {
  category: LinkCategory
  match(host: string, path: string, query: string): boolean
}

/** Git code-review / MR hosts (host segment match). */
const REVIEW_HOST_RE = /(^|\.)(gitlab|github|bitbucket|gitee|git\.bytedance|code\.byted|source\.byte|git\.code)\./

/** Central, ordered rule table: first match wins; `other` is the fallback. */
const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: 'meego',
    match: (host) => host === 'meego.bytedance.net' || host.endsWith('.meego.bytedance.net'),
  },
  {
    category: 'mr',
    match: (host, path, query) => {
      if (!REVIEW_HOST_RE.test(host)) return false
      return (
        /(\/(merge_request|pull|pullrequest|pr|mr)\b|\/(merge_requests|pulls)\/)/.test(path) ||
        /(merge_request_iid|pull_request|review)=/.test(query)
      )
    },
  },
  {
    category: 'deploy',
    match: (host, path, query) =>
      /(deploy|releaseops|pipeline|jenkins|argocd|tekton|ci\.)/.test(host) ||
      /(\/(deployments?|releases?|pipelines?|builds?|ci)\b|\/(deployments?|releases?|pipelines?|builds?)\/)/.test(path) ||
      /(pipeline|deployment)=/.test(query),
  },
  {
    category: 'artifact',
    match: (host, path) =>
      /(artifact|artifactory|nexus|jfrog|harbor|npmjs|pypi\.org|maven|registry\.|packages?\.|ccr\.)/.test(host) ||
      /(\/(artifacts?|packages?|downloads?)\b|\/(artifacts?|packages?|downloads?)\/)/.test(path),
  },
]

/**
 * Classify a URL into a category. The rule table is ordered — first match
 * wins. URLs that match nothing are classified `other` and are never
 * dropped by callers.
 */
export function classifyUrl(rawUrl: string): LinkCategory {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return 'other'
  }
  const host = u.hostname.toLowerCase()
  const path = u.pathname.toLowerCase()
  const query = u.search.toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.match(host, path, query)) return rule.category
  }
  return 'other'
}

/** Readable title: host plus a truncated path summary. */
export function linkTitle(rawUrl: string): string {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  const host = u.hostname.replace(/^www\./, '')
  const path = u.pathname === '/' ? '' : u.pathname
  if (!path) return host
  const summary = path.length > 60 ? `${path.slice(0, 60)}…` : path
  return `${host}${summary}`
}

/* ------------------------------------------------------------------ */
/* Message node collection                                             */
/* ------------------------------------------------------------------ */

function textBlocksOf(content: readonly ContentBlock[]): string[] {
  const texts: string[] = []
  for (const block of content) {
    // Merge-extensible union: only 'text' is collected; reasoning, images
    // and tool payloads (including nested tool-result content) are not.
    if (block.type === 'text') texts.push(block.text)
  }
  return texts
}

function assistantTextBlocks(blocks: readonly AssistantBlock[]): string[] {
  const texts: string[] = []
  for (const block of blocks) {
    if (block.kind === 'text') texts.push(block.text)
  }
  return texts
}

/**
 * Collect link entries from one conversation node. Only the four message
 * shapes are scanned (user / assistant / steering / context); assistant
 * links come from its visible text blocks only — reasoning and tool-call
 * payloads are never collected. Unknown node kinds are skipped safely.
 */
export function collectLinksFromNode(node: ConversationNode): LinkEntry[] {
  let role: LinkRole
  let texts: string[]
  switch (node.kind) {
    case 'user':
      role = 'user'
      texts = textBlocksOf(node.content)
      break
    case 'steering':
      role = 'steering'
      texts = textBlocksOf(node.content)
      break
    case 'context':
      role = 'context'
      texts = textBlocksOf(node.content)
      break
    case 'assistant':
      role = 'assistant'
      texts = assistantTextBlocks(node.blocks)
      break
    default:
      return []
  }
  const entries: LinkEntry[] = []
  for (const text of texts) {
    for (const url of extractUrls(text)) {
      entries.push({
        url,
        category: classifyUrl(url),
        time: node.time,
        seq: node.seq,
        role,
        title: linkTitle(url),
        count: 1,
      })
    }
  }
  return entries
}

/** Collect entries from every node of a conversation snapshot. */
export function collectLinksFromNodes(nodes: readonly ConversationNode[]): LinkEntry[] {
  const out: LinkEntry[] = []
  for (const node of nodes) out.push(...collectLinksFromNode(node))
  return out
}

/**
 * Display ordering within a category: newest last-seen time first; at equal
 * time assistant-sourced entries win; then highest seq (latest occurrence).
 */
export function compareEntries(a: LinkEntry, b: LinkEntry): number {
  if (a.time !== b.time) return b.time - a.time
  const r = ROLE_RANK[a.role] - ROLE_RANK[b.role]
  if (r !== 0) return r
  return b.seq - a.seq
}