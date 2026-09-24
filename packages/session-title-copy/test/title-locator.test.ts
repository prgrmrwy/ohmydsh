import { describe, expect, it } from 'vitest'
import { findCrumbNav, isCrumbButton, titleZoneOf, type ElementLike } from '../src/client/title-locator.js'

/**
 * Structural fake of the DOM surface the locator uses: querySelectorAll for
 * `header` / `button`, querySelector for `nav`, attributes and parent linkage.
 */
class FakeNode implements ElementLike {
  attrs = new Map<string, string>()
  children: FakeNode[] = []
  parentElement: FakeNode | null = null
  constructor(attrs: Record<string, string> = {}, children: FakeNode[] = []) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v)
    for (const child of children) child.parentElement = this
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
      return this.children.filter((c) => c.getAttribute(TAG) === 'header')
    }
    if (selector === 'button') {
      const out: FakeNode[] = []
      const walk = (nodes: FakeNode[]): void => {
        for (const n of nodes) {
          if (n.getAttribute(TAG) === 'button') out.push(n)
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
  return new FakeNode({ class: 'wSkVaW_crumbs', [TAG]: 'nav' }, buttons.map((b) => new FakeNode({ [TAG]: 'span' }, [b])))
}

function header(children: FakeNode[]): FakeNode {
  return new FakeNode({ class: 'wSkVaW_header', [TAG]: 'header' }, children)
}

/** titleCluster > nav + headerActions, wrapped in the official header chrome. */
function officialHeader(navButtons: FakeNode[]): FakeNode {
  const cluster = new FakeNode({ class: 'wSkVaW_titleCluster' }, [
    nav(navButtons),
    new FakeNode({ class: 'wSkVaW_headerActions' }),
  ])
  return header([new FakeNode({ class: 'wSkVaW_titleRow' }, [cluster])])
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

describe('findCrumbNav', () => {
  it('returns the breadcrumb nav inside the official header shape', () => {
    const navNode = nav([crumb(false), crumb(true, 'wSkVaW_crumbCurrent')])
    const root = new FakeNode({}, [header([new FakeNode({}, [new FakeNode({}, [navNode])])])])
    expect(findCrumbNav(root)).toBe(navNode)
  })

  it('ignores non-crumb buttons and still finds the nav', () => {
    const navNode = nav([new FakeNode({ class: 'wSkVaW_title', [TAG]: 'button' }), crumb(true)])
    const root = new FakeNode({}, [header([navNode])])
    expect(findCrumbNav(root)).toBe(navNode)
  })

  it('returns null when there is no header (hero/blank or other page)', () => {
    const root = new FakeNode({}, [new FakeNode({}, [])])
    expect(findCrumbNav(root)).toBeNull()
  })

  it('returns null when the header has no breadcrumb nav', () => {
    const root = new FakeNode({}, [header([new FakeNode({ class: 'wSkVaW_titleRow' })])])
    expect(findCrumbNav(root)).toBeNull()
  })

  it('returns null when the nav has no crumb button (structure changed — safe degrade)', () => {
    const root = new FakeNode({}, [header([nav([new FakeNode({ class: 'wSkVaW_title', [TAG]: 'button' })])])])
    expect(findCrumbNav(root)).toBeNull()
  })
})

describe('titleZoneOf', () => {
  it('returns the crumb nav parent (title cluster)', () => {
    const root = new FakeNode({}, [officialHeader([crumb(false), crumb(true)])])
    const navNode = findCrumbNav(root)
    expect(navNode).not.toBeNull()
    const zone = titleZoneOf(navNode!)
    expect(zone).toBe(navNode!.parentElement)
  })

  it('returns null for a detached nav (no parent)', () => {
    expect(titleZoneOf(new FakeNode({ [TAG]: 'nav' }))).toBeNull()
  })
})
