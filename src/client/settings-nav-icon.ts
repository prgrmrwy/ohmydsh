import { createElement } from 'react'
import { birdSvg } from './bird-svg.js'

const birdMask = `url("data:image/svg+xml,${encodeURIComponent(birdSvg)}") center / contain no-repeat`

/** Reuse the licensed bird artwork without reaching into the navigation DOM. */
export function MagpieSettingsNavIcon({ size }: { size: number }) {
  return createElement('span', {
    'aria-hidden': true,
    style: { display: 'inline-block', width: size, height: size, backgroundColor: 'currentColor', mask: birdMask, WebkitMask: birdMask },
  })
}
