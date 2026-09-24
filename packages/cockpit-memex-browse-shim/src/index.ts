import type { Context } from '@deepseek-ai/cordis'

/** Host half is intentionally inert; the integration lives in the web client. */
export const name = 'dsh-cockpit-memex-browse-shim'
export const inject: string[] = []
export function apply(_ctx: Context): void {}
