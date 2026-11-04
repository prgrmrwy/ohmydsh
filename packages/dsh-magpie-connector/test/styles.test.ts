// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { STYLE_ATTR, ensureStyles, settingsCss } from '../src/client/styles.js'

const injected = () => document.head.querySelectorAll(`style[${STYLE_ATTR}]`)

afterEach(() => { for (const node of Array.from(injected())) node.remove() })

describe('插件样式表', () => {
  it('注入到 document.head 且重复调用只有一个实例', () => {
    expect(injected()).toHaveLength(0)
    const first = ensureStyles()!
    const second = ensureStyles()!
    expect(second).toBe(first)
    expect(injected()).toHaveLength(1)
    expect(first.textContent).toBe(settingsCss)
    expect(first.parentElement).toBe(document.head)
  })

  it('样式表被移除后再次调用会补回', () => {
    ensureStyles()!.remove()
    expect(injected()).toHaveLength(0)
    ensureStyles()
    expect(injected()).toHaveLength(1)
  })
})
