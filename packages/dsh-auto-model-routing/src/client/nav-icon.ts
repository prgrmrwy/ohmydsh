import { createElement as h } from 'react'

/** Preserve the selected E glyph; the settings shell owns the navigation row. */
export function RoutingSettingsNavIcon({ size }: { size: number }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  },
  h('path', { d: 'M8 3C7.1 2.1 5.2 2.2 4.5 3.6C3.1 3.7 2.2 5 2.6 6.3C1.7 7.1 1.7 8.9 2.7 9.7C2.4 11.1 3.3 12.3 4.7 12.4C5.2 13.8 7.1 14.1 8 13.2Z' }),
  h('path', { d: 'M5.2 6.4C6 6.4 6.6 5.9 6.7 5.1M5.3 9.7C6.1 9.6 6.7 10.1 6.8 10.9M8 8H10M10 8C11.3 8 11.4 4.4 13.1 4.4M10 8C11.3 8 11.4 11.6 13.1 11.6M10 8H13.1' }),
  h('g', { fill: 'currentColor', stroke: 'none' },
    ...[4.4, 8, 11.6].map(cy => h('circle', { key: cy, cx: 14, cy, r: .9 }))),
  )
}
