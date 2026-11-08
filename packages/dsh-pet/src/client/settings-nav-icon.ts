import { createElement } from 'react'

/** The settings shell owns placement and lifecycle; keep the original mascot. */
export function PetSettingsNavIcon({ size }: { size: number }) {
  return createElement('span', {
    'aria-hidden': true,
    style: { display: 'inline-block', width: size, height: size, fontSize: size * 14 / 16, lineHeight: `${size}px`, textAlign: 'center' },
  }, '🐾')
}
