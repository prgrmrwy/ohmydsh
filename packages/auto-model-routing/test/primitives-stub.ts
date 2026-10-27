// The web shell provides @deepseek-ai/dsh-client-ui-primitives at runtime; tests never load the real bundle
// (its peers such as clsx/katex are shell-owned). Components receive test doubles through `ui` instead.
import { createElement } from 'react'
const missing = () => { throw new Error('primitives stub: pass test doubles through `ui`') }
export const Tooltip = missing
export const Menu = missing
export const IconGaugeOutlineRegular = missing
/** Rendered directly by the AUTO chip in its locked state, so the stub keeps a real element. */
export const IconInfoOutlineRegular = ({ size = 16, className }: { size?: number; className?: string } = {}) =>
  createElement('svg', { className, width: size, height: size, viewBox: '0 0 16 16', 'data-info-outline': 'true' })
