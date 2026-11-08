// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { apply } from '../src/client/index.js'
import { MagpieSettingsNavIcon } from '../src/client/settings-nav-icon.js'
import { birdSvg } from '../src/client/bird-svg.js'
import { fakeApi } from './client-support/fake-api.js'
import { fakeLocale } from './client-support/fake-locale.js'

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); document.body.replaceChildren() })

it('spec Scenario "鸟形图标只标记自身导航行"', () => {
  document.body.innerHTML = '<div role="dialog"><nav><button><span><svg/></span><span>Magpie</span></button><button><span><svg/></span><span>Magpie</span></button></nav></div>'
  const before = document.body.innerHTML
  const registered: { name: string; id: string; component: unknown }[] = []
  apply({
    slots: {
      inject: (_name: string, run: () => unknown) => run(),
      register: (options, component) => { registered.push({ name: options.name, id: options.id, component }); return () => {} },
    },
    locale: fakeLocale().service,
    get: () => undefined,
    effect: (run: () => () => void) => { disposers.push(run()) },
  }, fakeApi({}).api)
  expect(registered.filter(r => r.name === 'settings.section.icon')).toEqual([
    { name: 'settings.section.icon', id: 'dsh-magpie-connector', component: MagpieSettingsNavIcon },
  ])
  expect(document.body.innerHTML).toBe(before)
  expect(document.querySelector('[data-dsh-magpie-connector-settings-nav],style[data-dsh-magpie-connector-settings-nav-style]')).toBeNull()
})

it('reuses the licensed bird, shell size and currentColor without navigation CSS', () => {
  const markup = renderToStaticMarkup(createElement(MagpieSettingsNavIcon, { size: 24 }))
  expect(markup).toContain('width:24px;height:24px')
  expect(markup).toContain('background-color:currentColor')
  expect(markup).toContain(encodeURIComponent(birdSvg))
  expect(markup).toContain('aria-hidden="true"')
  expect(markup).not.toContain('<style')
})
