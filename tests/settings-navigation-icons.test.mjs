import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { JSDOM } from 'jsdom'
import React from 'react'
import { flushSync } from 'react-dom'

const require = createRequire(import.meta.url)
const ids = ['dsh-pet', 'dsh-memex', 'dsh-magpie-connector', 'auto-model-routing']
const packages = ['dsh-pet', 'dsh-memex', 'dsh-magpie-connector', 'dsh-auto-model-routing']

// Load real browser bundles through their factories with one host React.
function loadBundle(filename, dom) {
  let exports
  const window = dom.window
  const loader = window.__ModuleLoader__
  window.__ModuleLoader__ = { load({ factory }) { exports = factory(id => {
    // Settings content and composer controls are not mounted by this icon test.
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: () => () => null })
    return require(id)
  }) } }
  runInNewContext(readFileSync(filename, 'utf8'), {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, console,
    URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, structuredClone,
  }, { filename })
  window.__ModuleLoader__ = loader
  return exports
}

function locale() {
  const dictionaries = new Map()
  let language = 'zh'
  return {
    setLanguage(value) { language = value },
    register(namespace, values) {
      assert.equal(dictionaries.has(namespace), false)
      dictionaries.set(namespace, values)
      return () => dictionaries.delete(namespace)
    },
    bind(namespace) { return key => dictionaries.get(namespace)?.[language]?.[key] ?? key },
  }
}

for (const hasIconSlot of [true, false]) {
  test(`real DSH slots: four icons, lifecycle and fallback (icon seat ${hasIconSlot ? 'present' : 'absent'})`, async () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' })
    const prior = Object.getOwnPropertyDescriptors(globalThis)
    for (const key of ['window', 'document', 'HTMLElement', 'MutationObserver']) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] })
    }
    // Lottie's module-level feature probe is unrelated to settings navigation.
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillStyle: '' })
    const ctx = new Context()
    let root
    try {
      const rendererPath = require.resolve('@deepseek-ai/dsh-client-ui-renderer/client')
      const renderer = loadBundle(rendererPath, dom)
      await ctx.plugin({ name: 'real-renderer', apply: renderer.apply })
      const children = {
        'settings.section': { kind: 'list', scope: 'root' },
        'conversation.input.right': { kind: 'list', scope: 'session-maybe' },
        'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      }
      if (hasIconSlot) children['settings.section.icon'] = { kind: 'list', scope: 'root', inline: true }
      let selected = ids[0]
      let iconSize = 16
      function Shell({ renderSlot }) {
        const rows = ctx.slots.entries('settings.section')
        return React.createElement('div', { role: 'dialog' }, React.createElement('nav', null,
          ...rows.map(({ options }) => React.createElement('button', {
            key: options.id, 'data-section': options.id,
            'aria-current': selected === options.id ? 'true' : undefined,
            onClick: () => { selected = options.id; render() },
          },
          React.createElement('span', { 'aria-hidden': true, 'data-icon': '' }, hasIconSlot
            ? renderSlot('settings.section.icon', { size: iconSize, active: selected === options.id }, {
              only: options.id, fallback: React.createElement('svg', { 'data-default': '' }),
            })
            : React.createElement('svg', { 'data-default': '' })),
          React.createElement('span', { 'data-label': '' }, typeof options.label === 'function' ? options.label() : options.label),
          )),
        ))
      }
      await ctx.plugin({ name: 'settings-shell-fixture', inject: ['slots'], apply(scope) {
        const absent = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
        const source = { getSnapshot: () => absent, subscribe: () => () => {} }
        scope.slots.installScope('session', { current: source, bindingSource: () => source, renderArea: () => null })
        scope.slots.register({ name: 'root', children }, Shell)
        for (const id of ['plugins', 'old-connect']) scope.slots.register({ name: 'settings.section', id, label: 'Magpie' }, () => null)
      } })
      const clientBundles = packages.map(name => loadBundle(new URL(`../packages/${name}/lib/client.js`, import.meta.url).pathname, dom))
      const languages = packages.map(() => locale())
      const mountClients = async () => {
        const forks = []
        for (const [index, client] of clientBundles.entries()) {
          forks.push(await ctx.plugin({ name: `icon-client-${index}`, inject: ['slots'], apply(scope) {
            client.apply({
              slots: scope.slots,
              locale: languages[index],
              // Pet's independent floating surface is unrelated to settings navigation.
              effect: (callback, label) => label === 'dsh-pet: floating surface on its own root' ? () => {} : scope.effect(callback, label),
              provide: (name, value) => scope.provide(name, value),
              get: name => name === 'connection' ? { rpc: {} } : undefined,
              configForms: { get: () => ({}) },
            })
          } }))
        }
        return forks
      }
      let forks = await mountClients()
      const host = dom.window.document.querySelector('#root')
      root = require('react-dom/client').createRoot(host)
      function render() { flushSync(() => root.render(ctx.slots.renderSlot('root', {}))) }
      const button = id => host.querySelector(`[data-section="${id}"]`)
      const assertIcons = () => {
        for (const [index, id] of ids.entries()) {
          const own = button(id)
          assert.ok(own, `${id} section still registers`)
          assert.equal(own.querySelectorAll('[data-default]').length, hasIconSlot ? 0 : 1, `${id} fallback`)
          if (hasIconSlot) {
            assert.equal(own.querySelectorAll('[data-icon] svg').length, index === 1 || index === 3 ? 1 : 0)
            if (index === 0) assert.equal(own.querySelector('[data-icon]').textContent, '🐾')
            if (index === 2) assert.match(own.querySelector('[data-icon]').innerHTML, /background-color:\s*currentcolor/i)
          }
        }
        for (const id of ['plugins', 'old-connect']) assert.equal(button(id).querySelectorAll('[data-default]').length, 1)
        assert.equal(dom.window.document.querySelector('[data-dsh-pet-settings-nav],[data-dsh-memex-settings-nav],[data-dsh-magpie-connector-settings-nav],[data-amr-nav]'), null)
        assert.equal(dom.window.document.querySelector('style[data-amr-nav-style],style[data-dsh-magpie-connector-settings-nav-style]'), null)
      }
      render()
      assertIcons()
      if (hasIconSlot) assert.equal(ctx.slots.entries('settings.section.icon').length, 4)
      for (const language of ['en', 'zh']) {
        languages.forEach(value => value.setLanguage(language))
        for (const dark of [false, true]) {
          dom.window.document.body.toggleAttribute('data-ds-dark-theme', dark)
          render()
          assertIcons()
          assert.equal(button('dsh-memex').querySelector('[data-label]').textContent, language === 'en' ? 'Memory' : '记忆')
        }
      }
      iconSize = 24
      render()
      if (hasIconSlot) {
        assert.equal(button('dsh-memex').querySelector('svg').getAttribute('width'), '24')
        assert.equal(button('auto-model-routing').querySelector('svg').getAttribute('stroke'), 'currentColor')
        assert.match(button('dsh-pet').querySelector('[data-icon]').innerHTML, /width: 24px|width:24px/)
      }
      button('dsh-magpie-connector').click()
      assert.equal(button('dsh-magpie-connector').getAttribute('aria-current'), 'true')
      assertIcons()
      for (const fork of forks) await fork.dispose()
      render()
      assert.equal(ctx.slots.entries('settings.section.icon').length, 0)
      // Keep a section while its icon contribution is absent: the shell must restore its fallback.
      const disposeSection = ctx.slots.register({ name: 'settings.section', id: ids[0], label: 'Pet' }, () => null)
      render()
      assert.equal(button(ids[0]).querySelectorAll('[data-default]').length, 1)
      disposeSection()
      forks = await mountClients()
      render()
      assertIcons()
      if (hasIconSlot) assert.equal(ctx.slots.entries('settings.section.icon').length, 4)
      for (const fork of forks) await fork.dispose()
    } finally {
      if (root) flushSync(() => root.unmount())
      await ctx.fiber.dispose()
      dom.window.close()
      for (const key of ['window', 'document', 'HTMLElement', 'MutationObserver']) {
        if (prior[key]) Object.defineProperty(globalThis, key, prior[key])
        else delete globalThis[key]
      }
    }
  })
}
