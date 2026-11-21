/**
 * Which strings count as a Feishu message link the Host may resolve.
 *
 * Change `locus-read-referenced-chats` lets a child read the message a link in
 * THIS chat points at. The model never supplies the URL: the Host takes it from
 * the platform body of a message it has already proven to be in the entrance
 * chat. This module is the one definition of "a message link", shared by the
 * tool (raw platform body) and by discovery (history lines, prompt text):
 *
 * - parsed with WHATWG `URL`, never matched by path shape alone;
 * - `https:` only, no userinfo, hostname exactly in the allowlist;
 * - pathname exactly `/client/message/link/open`, exactly one non-empty `token`;
 * - deduplicated by normalized href, in order of first appearance, at most 10.
 *
 * Discovery is only a hint: authorization is re-proven from the raw body at
 * call time.
 */

/** Hosts the measured links use (Feishu brand). */
export const DEFAULT_MESSAGE_LINK_HOSTS: readonly string[] = ['applink.feishu.cn', 'applink.larkoffice.com']

/** At most this many links are numbered per message. */
export const MAX_MESSAGE_LINKS = 10

const MESSAGE_LINK_PATH = '/client/message/link/open'

/** URL-looking runs in free text; validation happens afterwards. */
const URL_RUN = /https?:\/\/[^\s<>"'`，。！？；、（）【】「」『』《》]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/**
 * Normalize one candidate, or `undefined` when it is not a message link.
 * @param candidate - Raw string from a body.
 * @param hosts - Exact hostname allowlist.
 */
export function normalizeMessageLink(candidate: string, hosts: readonly string[] = DEFAULT_MESSAGE_LINK_HOSTS): string | undefined {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (!hosts.includes(url.hostname)) return undefined
  if (url.pathname !== MESSAGE_LINK_PATH) return undefined
  const tokens = url.searchParams.getAll('token')
  if (tokens.length !== 1 || tokens[0] === '') return undefined
  return url.href
}

function runsIn(text: string): string[] {
  return [...text.matchAll(URL_RUN)].map(match => match[0].replace(TRAILING_PUNCTUATION, ''))
}

function collect(candidates: readonly string[], hosts: readonly string[]): string[] {
  const links: string[] = []
  for (const candidate of candidates) {
    const link = normalizeMessageLink(candidate, hosts)
    if (link === undefined || links.includes(link)) continue
    links.push(link)
    if (links.length >= MAX_MESSAGE_LINKS) break
  }
  return links
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Candidates of a post body: paragraph order, element order; `a` contributes its href. */
function postCandidates(content: Record<string, unknown>): string[] {
  const paragraphs = content['content']
  if (!Array.isArray(paragraphs)) return []
  const candidates: string[] = []
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph)) continue
    for (const element of paragraph) {
      const record = recordOf(element)
      if (record === undefined) continue
      if (record['tag'] === 'a' && typeof record['href'] === 'string') candidates.push(record['href'])
      if (typeof record['text'] === 'string') candidates.push(...runsIn(record['text']))
    }
  }
  return candidates
}

/**
 * Message links in a RAW platform body (`body.content` of the raw read).
 * Only `text` and `post` carry links the Host follows; anything else, or a body
 * that is not JSON, has none.
 * @param msgType - Platform message type.
 * @param content - Raw `body.content` string.
 * @param hosts - Exact hostname allowlist.
 */
export function extractMessageLinksFromRaw(
  msgType: string,
  content: string,
  hosts: readonly string[] = DEFAULT_MESSAGE_LINK_HOSTS,
): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }
  const record = recordOf(parsed)
  if (record === undefined) return []
  if (msgType === 'text') return typeof record['text'] === 'string' ? collect(runsIn(record['text']), hosts) : []
  if (msgType === 'post') return collect(postCandidates(record), hosts)
  return []
}

/**
 * Message links in already-rendered text (a history line, the prompt's request
 * text). Discovery only; never an authorization input.
 * @param text - Rendered text.
 * @param hosts - Exact hostname allowlist.
 */
export function extractMessageLinksFromText(text: string, hosts: readonly string[] = DEFAULT_MESSAGE_LINK_HOSTS): string[] {
  return collect(runsIn(text), hosts)
}
