// The web shell provides @deepseek-ai/dsh-client-ui-primitives at runtime; tests never load the real bundle
// (its peers such as clsx/katex are shell-owned). Components receive test doubles through `ui` instead.
const missing = () => { throw new Error('primitives stub: pass test doubles through `ui`') }
export const Tooltip = missing
export const Menu = missing
export const IconGaugeOutlineRegular = missing
