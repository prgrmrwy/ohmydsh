/**
 * CSP rewriting for the injected inline script (design D6, spec HTML 注入与传输语义).
 *
 * Per policy, the EFFECTIVE script directive is `script-src-elem`, else `script-src`,
 * else `default-src`. If it exists:
 *  - allows inline only through `'unsafe-inline'` (no nonce, hash or `'strict-dynamic'`):
 *    leave it — adding a nonce would make browsers ignore `'unsafe-inline'` and tighten the policy;
 *  - otherwise append `'nonce-<N>'` (with an existing nonce/hash/'strict-dynamic' the browser
 *    already ignores `'unsafe-inline'`, so appending is required for the injected script to run).
 * Policies without an effective script directive are untouched.
 */

const NONCE_OR_HASH = /^'(?:nonce-|sha256-|sha384-|sha512-)/i

function rewritePolicy(policy: string, nonce: string): string {
  const directives = policy.split(';')
  const nameOf = (directive: string): string => directive.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const index = ['script-src-elem', 'script-src', 'default-src']
    .map((wanted) => directives.findIndex((directive) => nameOf(directive) === wanted))
    .find((found) => found !== -1)
  if (index === undefined) return policy
  const directive = directives[index] as string
  const tokens = directive.trim().split(/\s+/).slice(1).map((token) => token.toLowerCase())
  const onlyUnsafeInline = tokens.includes("'unsafe-inline'") && !tokens.some((token) => NONCE_OR_HASH.test(token) || token === "'strict-dynamic'")
  if (onlyUnsafeInline) return policy
  directives[index] = `${directive.trimEnd()} 'nonce-${nonce}'`
  return directives.join(';')
}

/** Rewrite every policy of a (possibly comma-joined) CSP header value. */
export function addNonceToCsp(csp: string, nonce: string): string {
  return csp.split(',').map((policy) => rewritePolicy(policy, nonce)).join(',')
}
