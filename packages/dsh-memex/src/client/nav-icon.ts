import { createElement as h } from 'react'

/** The original outline book, rendered inside the shell's official icon seat. */
export function MemexSettingsNavIcon({ size }: { size: number }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }, h('path', { d: 'M2.4 2.6h4.1a1.6 1.6 0 0 1 1.5 1.1 1.6 1.6 0 0 1 1.5-1.1h4.1v9.4H9.5a1.5 1.5 0 0 0-1.5 1.3 1.5 1.5 0 0 0-1.5-1.3H2.4z' }))
}
