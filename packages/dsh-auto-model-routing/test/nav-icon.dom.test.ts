// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoutingSettingsNavIcon } from '../src/client/nav-icon.js'
import { apply } from '../src/client/index.js'
import { fakeLocale } from './fake-locale.js'

it('spec Scenario "导航图标只作用于本区块"', () => {
  const registrations: { name: string; id: string; component: unknown }[] = []
  const cleanups: (() => void)[] = []
  const observe = document.body.innerHTML
  apply({
    locale: fakeLocale('zh').service,
    effect: (run: () => () => void) => { cleanups.push(run()) },
    slots: {
      inject: (_name: string, run: () => unknown) => run(),
      register: (options: { name: string; id: string }, component: unknown) => { registrations.push({ ...options, component }); return () => {} },
    },
  } as never)
  expect(registrations.filter(r => r.name === 'settings.section.icon')).toEqual([
    { name: 'settings.section.icon', id: 'auto-model-routing', component: RoutingSettingsNavIcon },
  ])
  expect(document.body.innerHTML).toBe(observe)
  expect(document.querySelector('[data-amr-nav],style[data-amr-nav-style]')).toBeNull()
  for (const cleanup of cleanups.reverse()) cleanup()
})

it('preserves E artwork and scales the theme-colored glyph', () => {
  const markup = renderToStaticMarkup(createElement(RoutingSettingsNavIcon, { size: 24 }))
  expect(markup).toContain('width="24" height="24"')
  expect(markup).toContain('stroke="currentColor"')
  expect(markup).toContain('fill="currentColor"')
  expect(markup.match(/<circle/g)).toHaveLength(3)
  expect(markup).toContain('M8 3C7.1 2.1')
})
