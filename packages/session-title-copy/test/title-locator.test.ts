import { describe, expect, it } from 'vitest'
import { findCurrentTitleButton, isCrumbButton, type ElementLike } from '../src/client/title-locator.js'

/**
 * Structural fake of the DOM surface the locator uses: querySelectorAll for
 * `header` / `button`, querySelector for `nav`, attribute reads.
 */
class FakeNode implements ElementLike {
  attrs = new Map<string, string>()
  children: FakeNode[] = []
  constructor(attrs: Record<string, string> = {}, children: FakeNode[] = []) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v)
    this.children = children
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name)
  }

  querySelector(selector: string): ElementLike | null {
    if (selector === 'nav') {
      const walk = (nodes: FakeNode[]): FakeNode | null => {
        for (const n of nodes) {
          if (n.getAttribute(TAG) === 'nav') return n
          const found = walk(n.children)
          if (found !== null) return found
        }
        return null
      }
      return walk(this.children)
    }
    return null
  }

  querySelectorAll(selector: string): ElementLike[] {
    if (selector === 'header') {
      return this.children.filter((c) => c.getAttribute('data-tag') === 'header')
    }
    if (selector === 'button') {
      const out: FakeNode[] = []
      const walk = (nodes: FakeNode[]): void => {
        for (const n of nodes) {
          if (n.getAttribute('data-tag') === 'button') out.push(n)
          walk(n.children)
        }
      }
      walk(this.children)
      return out
    }
    return []
  }
}

const TAG = 'data-tag'

function crumb(disabled = false, extra = ''): FakeNode {
  return new FakeNode(
    { class: `wSkVaW_crumb ${extra}`.trim(), [TAG]: 'button', ...(disabled ? { disabled: '' } : {}) },
  )
}

function nav(buttons: FakeNode[]): FakeNode {
  return new FakeNode({ [TAG]: 'nav' }, buttons.map((b) => new FakeNode({ [TAG]: 'span' }, [b])))
}

function header(children: FakeNode[]): FakeNode {
  return new FakeNode({ [TAG]: 'header' }, children)
}

function officialHeader(navButtons: FakeNode[]): FakeNode {
  return header([
    new FakeNode({}, [
      new FakeNode({}, [new FakeNode({ [TAG]: 'nav' }, navButtons)]),
    ]),
  ])
}

describe('isCrumbButton', () => {
  it('matches the hashed base crumb token', () => {
    expect(isCrumbButton(new FakeNode({ class: 'wSkVaW_crumb' }))).toBe(true)
    expect(isCrumbButton(new FakeNode({ class: 'abc_crumb  def_crumbCurrent' }))).toBe(true)
  })

  it('rejects crumbCurrent-only, subagent and unrelated tokens', () => {
    expect(isCrumbButton(new FakeNode({ class: 'wSkVaW_crumbCurrent' }))).toBe(false)
    expect(isCrumbButton(new FakeNode({ class: 'wSkVaW_crumbSubagent' }))).toBe(false)
    expect(isCrumbButton(new FakeNode({ class: 'wSkVaW_title wSkVaW_time' }))).toBe(false)
    expect(isCrumbButton(new FakeNode({}))).toBe(false)
  })
})

describe('findCurrentTitleButton', () => {
  it('returns the disabled crumb (current session title)', () => {
    const ancestor = crumb(false)
    const current = crumb(true, 'wSkVaW_crumbCurrent')
    const root = new FakeNode({}, [officialHeader([ancestor, current])])
    expect(findCurrentTitleButton(root)).toBe(current)
  })

  it('ignores disabled non-crumb buttons and still finds the crumb', () => {
    const current = crumb(true)
    const actionsButton = new FakeNode({ class: 'wSkVaW_headerUtilityButton', [TAG]: 'button', disabled: '' })
    const root = new FakeNode({}, [
      header([nav([current]), actionsButton]),
    ])
    expect(findCurrentTitleButton(root)).toBe(current)
  })

  it('returns null when there is no header (hero/blank or other page)', () => {
    const root = new FakeNode({}, [new FakeNode({}, [])])
    expect(findCurrentTitleButton(root)).toBeNull()
  })

  it('returns null when the header has no breadcrumb nav', () => {
    const root = new FakeNode({}, [header([new FakeNode({ class: 'wSkVaW_titleRow' })])])
    expect(findCurrentTitleButton(root)).toBeNull()
  })

  it('returns null when the nav has no disabled crumb (structure changed — safe degrade)', () => {
    const enabledOnly = crumb(false)
    const root = new FakeNode({}, [officialHeader([enabledOnly])])
    expect(findCurrentTitleButton(root)).toBeNull()
  })
})
