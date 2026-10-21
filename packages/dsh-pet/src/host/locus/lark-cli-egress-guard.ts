/**
 * Mistake-prevention guard for direct Lark writes from a shell-tier child.
 *
 * This deliberately recognizes only common `lark-cli` write spellings. It is
 * NOT an egress boundary: scripts, HTTP clients, copied binaries and alternate
 * command forms can bypass it. The shell tier explicitly accepts that risk.
 */
export const LOCUS_LARK_CLI_OUTBOUND_DENIAL =
  '业务回复只能经 pet_locus_finish；若 finish 被拒，请在回复中说明拒绝原因，不要绕行发送。'

const LARK_IM_WRITE = /\bim\s+\+(?:messages-send|messages-reply|messages-recall|messages-update|messages-forward)\b/i
// Doc-comment loci (pet-locus-doc-comments D8): comment writes and doc body writes.
const LARK_DRIVE_COMMENT_WRITE =
  /\bdrive\s+\+(?:add-comment|add-reply|update-reply|delete-reply|resolve-comment|restore-comment|react-reply)\b/i
const LARK_DOCS_WRITE = /\bdocs\s+\+(?:update|create)\b/i
// Raw API writes, with or without the `/open-apis` prefix (the prefixed form
// previously slipped past). Covers IM messages, drive comments and docx bodies.
const LARK_API_WRITE =
  /\bapi\s+(?:post|put|patch|delete)\s+(?:\/open-apis)?\/(?:im\/v1\/messages|drive\/v[12]\/files\/[^\s/]+\/comments|docx\/v1\/documents)\b/i

function commandOf(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : undefined
}

/** Return a deterministic denial only for common direct Lark write commands. */
export function locusLarkCliOutboundGuard(exec: {
  readonly name: string
  readonly arguments: unknown
}): string | undefined {
  if (exec.name !== 'bash') return undefined
  const raw = commandOf(exec.arguments)
  if (raw === undefined) return undefined
  // This is a small command-string heuristic, not a shell parser: collapse
  // spacing and remove quoting to catch ordinary quoting/whitespace variants.
  const normalized = raw.replace(/[\"'`]/g, '').replace(/\s+/g, ' ').trim()
  if (!/\blark-cli\b/i.test(normalized)) return undefined
  return LARK_IM_WRITE.test(normalized) ||
    LARK_DRIVE_COMMENT_WRITE.test(normalized) ||
    LARK_DOCS_WRITE.test(normalized) ||
    LARK_API_WRITE.test(normalized)
    ? LOCUS_LARK_CLI_OUTBOUND_DENIAL
    : undefined
}
