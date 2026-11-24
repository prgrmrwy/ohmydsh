/**
 * The inline `<script nonce>` injected into proxied HTML: per-response config
 * (`globalThis[INJECT_CONFIG_GLOBAL]`) followed by the bundled page script
 * (src/inject, built to an IIFE and inlined as `virtual:dshls/inject`).
 */
import { randomBytes } from 'node:crypto'
import injectSource from 'virtual:dshls/inject'
import { INJECT_CONFIG_GLOBAL } from '../contract.js'
import type { InjectConfig } from '../contract.js'

/** Escape every non-ASCII UTF-16 unit so the markup is ASCII and survives any ASCII-compatible page charset. */
const asciiOnly = (text: string): string => text.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

/** Make script text safe inside an HTML `<script>` element without changing what it does. */
function embedScript(code: string): string {
  return asciiOnly(code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'))
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url')
}

export function buildInjectMarkup(nonce: string, config: InjectConfig): string {
  const json = asciiOnly(JSON.stringify(config)).replace(/</g, '\\u003c')
  const script = `globalThis[${JSON.stringify(INJECT_CONFIG_GLOBAL)}]=${json};${embedScript(injectSource)}`
  return `<script nonce="${nonce}">${script}</script>`
}
