// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { fakeApi } from './client-support/fake-api.js'
import { fakeLocale } from './client-support/fake-locale.js'

const MARKER = 'data-dsh-magpie-connector-settings-nav'
const STYLE = 'style[data-dsh-magpie-connector-settings-nav-style]'
const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks() })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function mount() {
  const registered: { label?: () => string }[] = []
  apply({
    slots: { inject: (_name: string, run: () => unknown) => { run() }, register: registration => { registered.push(registration); return () => {} } },
    locale: fakeLocale().service,
    get: () => undefined,
    effect: (run: () => () => void) => { disposers.push(run()) },
  }, fakeApi({}).api)
  return registered[0]!.label!()
}
function dialog(label = 'Magpie') {
  const root = document.createElement('div')
  root.setAttribute('role', 'dialog')
  root.innerHTML = `<nav><button><svg aria-hidden="true"><path d="M0 0"/></svg><span>${label}</span></button><button data-old-connect><svg data-original="true"/><span>Magpie 网关</span></button><button><svg/><span>Memory</span></button></nav>`
  document.body.append(root)
  return root
}

it('spec Scenario "鸟形图标只标记自身导航行"', async () => {
  const label = mount()
  expect(document.querySelector(STYLE)).not.toBeNull()
  const root = dialog(label)
  const own = root.querySelector('button')!
  const old = root.querySelector('[data-old-connect]')!
  const oldBytes = old.outerHTML
  const ownBytes = own.innerHTML
  const clicked = vi.fn()
  own.addEventListener('click', clicked)
  await flush()
  expect(own.hasAttribute(MARKER)).toBe(true)
  expect(root.querySelectorAll(`[${MARKER}]`)).toHaveLength(1)
  expect(own.innerHTML).toBe(ownBytes)
  expect(old.outerHTML).toBe(oldBytes)
  own.click()
  expect(clicked).toHaveBeenCalledOnce()
  const css = document.querySelector(STYLE)!.textContent!
  expect(css).toContain(`[${MARKER}] > svg:first-child`)
  expect(css).toContain('background-color:currentColor')
  expect(css).toContain('mask-image:url("data:image/svg+xml,')
  expect(css).not.toMatch(/https?:\/\//)
  root.remove()
  const replacement = dialog(label)
  await flush()
  expect(replacement.querySelector('button')!.hasAttribute(MARKER)).toBe(true)
})

it('spec Scenario "卸载清理与缺失入口静默降级"', async () => {
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
  mount()
  const missing = dialog('Not Magpie')
  await flush()
  expect(document.querySelector(`[${MARKER}]`)).toBeNull()
  missing.remove()
  const root = dialog()
  await flush()
  expect(root.querySelector('button')!.hasAttribute(MARKER)).toBe(true)
  // Connect's English label is also Magpie; ambiguity must not mark either row.
  const duplicate = root.querySelector('[data-old-connect]')!
  duplicate.querySelector('span')!.textContent = 'Magpie'
  await flush()
  expect(document.querySelector(`[${MARKER}]`)).toBeNull()
  duplicate.parentNode!.removeChild(duplicate)
  await flush()
  expect(root.querySelector('button')!.hasAttribute(MARKER)).toBe(true)
  // A lone English connect row is not ours either (connect owns this marker).
  const own = root.querySelector('button')!
  own.remove()
  duplicate.setAttribute('data-dsh-magpie-connector-nav-icon', '')
  root.querySelector('nav')!.append(duplicate)
  await flush()
  expect(duplicate.hasAttribute(MARKER)).toBe(false)
  duplicate.remove()
  root.querySelector('nav')!.append(own)
  await flush()
  disposers.splice(0).forEach(dispose => dispose())
  expect(disconnect).toHaveBeenCalledOnce()
  expect(document.querySelector(STYLE)).toBeNull()
  expect(document.querySelector(`[${MARKER}]`)).toBeNull()
  dialog()
  await flush()
  expect(document.querySelector(`[${MARKER}]`)).toBeNull()
})

it('no DOM client installation is a silent no-op for the icon', () => {
  vi.stubGlobal('document', undefined)
  try { expect(mount).not.toThrow() } finally { vi.unstubAllGlobals() }
})
