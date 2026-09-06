/**
 * The overlay's channel-binding hint.
 *
 * Asserted against the SOURCE rather than a rendered tree because the hint's
 * conditions are what matter — which state shows it, which hides it, and that
 * dismissal is remembered per browser. Rendering it would require mounting the
 * whole mascot with a live Host behind it.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PET_CSS } from '../src/client/styles.js'

const overlaySource = await readFile(
  path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
  'utf8',
)

describe('when the hint appears', () => {
  it('requires the Host to have answered that no bot is bound', () => {
    // `undefined` means "not asked yet". Treating it as "unbound" would flash
    // a wrong hint at a Pet that is in fact connected.
    expect(overlaySource).toContain('botBound === false && !channelHintDismissed')
  })

  it('yields to the Skill hint rather than stacking with it', () => {
    // A Pet with no capabilities needs a Skill first; the two hints occupy
    // the same note slot and only one may claim it.
    expect(overlaySource).toContain('shortcuts.length === 0 && degraded === undefined')
    expect(overlaySource).toContain('shortcuts.length > 0 && degraded === undefined && showChannelHint')
  })

  it('stays hidden while Pet is degraded', () => {
    // A broken Pet has a more urgent message to show.
    const hint = overlaySource.slice(overlaySource.indexOf('showChannelHint ?'))
    expect(overlaySource).toMatch(/degraded === undefined && showChannelHint/)
    expect(hint.length).toBeGreaterThan(0)
  })

  it('points at the Channel settings tab', () => {
    expect(overlaySource).toContain('设置 → Pet → 飞书')
  })
})

describe('dismissal', () => {
  it('remembers the choice per browser', () => {
    // Display state for one browser, like the mascot position — losing it
    // merely shows the hint again.
    expect(overlaySource).toContain("const CHANNEL_HINT_DISMISSED_KEY = 'dshpet.channelHintDismissed'")
    expect(overlaySource).toContain('localStorage?.setItem(CHANNEL_HINT_DISMISSED_KEY')
    expect(overlaySource).toContain('localStorage?.getItem(CHANNEL_HINT_DISMISSED_KEY)')
  })

  it('survives storage being unavailable', () => {
    // A blocked localStorage costs one extra reminder, never a crash.
    const initializer = overlaySource.slice(
      overlaySource.indexOf('const [channelHintDismissed'),
      overlaySource.indexOf('const showChannelHint'),
    )
    expect(initializer).toContain('try {')
    expect(initializer).toContain('catch {')
  })

  it('does not touch the Channel settings tab', async () => {
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Dismissing the overlay hint must not remove the permanent way in.
    expect(settings).not.toContain('CHANNEL_HINT_DISMISSED_KEY')
    expect(settings).toContain('function ChannelTab')
  })
})

describe('clearing after binding', () => {
  it('re-reads the channel on the same broadcast that reloads capabilities', () => {
    // Binding happens in Settings, a separate mount point, so the hint must
    // clear without a page reload.
    const reload = overlaySource.slice(
      overlaySource.indexOf('const reloadCapabilities'),
      overlaySource.indexOf('const reloadCapabilities') + 900,
    )
    expect(reload).toContain('petApi\n        .channel()')
    expect(reload).toContain('setBotBound(channel.bot !== undefined)')
  })

  it('shows nothing when the Host has no channel at all', () => {
    // A Pet composed without the channel must not be nagged to configure one.
    expect(overlaySource).toContain('petApi.channel().catch(() => undefined)')
    expect(overlaySource).toContain('channel !== undefined) setBotBound')
  })
})

describe('the dismiss affordance is styled', () => {
  it('reads as secondary to the hint it sits in', () => {
    expect(PET_CSS).toContain('.dshpet-note-dismiss{')
    expect(PET_CSS).toContain('text-decoration:underline')
  })
})
