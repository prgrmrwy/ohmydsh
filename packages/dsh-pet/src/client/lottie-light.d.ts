/**
 * Type declaration for the light lottie build we bundle.
 *
 * `lottie-web` ships types for the root entry and for `lottie_light.js`, but
 * not for the `.min.js` file we import (min files are excluded from its
 * package types). The runtime shape is the same as `lottie_light`; the
 * animation-facing types come from the package root.
 */
declare module 'lottie-web/build/player/lottie_light.min.js' {
  import type { AnimationConfigWithData, AnimationItem } from 'lottie-web'

  const lottie: {
    loadAnimation(params: AnimationConfigWithData): AnimationItem
  }

  export default lottie
}
