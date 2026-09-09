import { describe, expect, it } from 'vitest'
import { COMPOSER_FALLBACK_CSS } from '../src/client/index.js'

/**
 * Guards the temporary compensation for the DSH 0.1.2-rc.1 composer
 * regression: a blocked composer with an empty draft renders no Lexical
 * paragraph, so its content box collapses to 0 and the absolutely-positioned
 * reason text is clipped away by the scroller's overflow.
 *
 * These assertions pin the properties that make the fallback survive runtime
 * rebuilds; they do NOT prove the visual outcome. Real rendering is verified
 * on a restricted-egress machine (see the change's tasks 4.5-4.7).
 */
describe('composer height fallback', () => {
  it('restores a one-line floor on the composer content wrapper', () => {
    expect(COMPOSER_FALLBACK_CSS).toContain('[data-input-scroll] > div')
    expect(COMPOSER_FALLBACK_CSS).toContain('min-height:24px')
  })

  it('anchors only on stable data-* attributes, never on build-time hashed class names', () => {
    // `uV2eYG_` is the runtime's current CSS-module hash prefix. It changes on
    // every rebuild, so depending on it would silently break after upgrades.
    expect(COMPOSER_FALLBACK_CSS).not.toContain('uV2eYG_')
    expect(COMPOSER_FALLBACK_CSS).not.toMatch(/\.[A-Za-z0-9]+_[A-Za-z]/)
  })

  it('targets the wrapper rather than the editor, so it cannot fight the official hero rule', () => {
    // The official rule is `.hero .input{min-height:52px}`. Writing our floor
    // on the editor itself would put two rules on the same element+property;
    // the wrapper keeps them orthogonal.
    expect(COMPOSER_FALLBACK_CSS).not.toContain('data-composer-input')
  })

  it('is a floor only — it must not override height or collapse other states', () => {
    expect(COMPOSER_FALLBACK_CSS).not.toMatch(/(?<!min-)height\s*:/)
    expect(COMPOSER_FALLBACK_CSS).not.toContain('max-height')
  })
})
