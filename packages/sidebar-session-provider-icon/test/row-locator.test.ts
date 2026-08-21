import { describe, expect, it } from 'vitest'
import {
  isSessionRow,
  sessionIdOfRow,
  titleNodeOf,
} from '../src/client/row-locator.js'
import { providerBySession, providerTitleIndex } from '../src/client/provider-map.js'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

/** Minimal structural fake of a session row node (role + class + one title child). */
function rowNode(classes: string[], titleText?: string): {
  getAttribute(name: string): string | null
  querySelector(sel: string): { textContent: string | null } | null
} {
  return {
    getAttribute(name) {
      if (name === 'class') return classes.join(' ')
      if (name === 'role') return 'treeitem'
      return null
    },
    querySelector(sel) {
      if (sel.endsWith('title"]') && titleText !== undefined) return { textContent: titleText }
      return null
    },
  }
}

function listState(rows: Array<{ id: string; title: string; provider: string | null; model: string }>): SessionListState {
  const byId = {} as SessionListState['byId']
  const ids = rows.map((r) => r.id)
  for (const r of rows) {
    byId[r.id] = {
      id: r.id,
      displayTitle: r.title,
      blank: false,
      running: false,
      updatedAt: 0,
      ...(r.provider === null ? {} : { projectionValues: { provider: { provider: r.provider, model: r.model } } }),
    } as SessionListState['byId'][string]
  }
  return { ids, byId, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
}

describe('row-locator', () => {
  it('identifies an official session row and rejects project/search rows', () => {
    expect(isSessionRow(rowNode(['YDXeBa_sessionRow', 'YDXeBa_selected']))).toBe(true)
    expect(isSessionRow(rowNode(['YDXeBa_projectRow']))).toBe(false)
    expect(isSessionRow(rowNode(['YDXeBa_searchResultRow']))).toBe(false)
  })

  it('extracts the title node via suffix match', () => {
    const row = rowNode(['YDXeBa_sessionRow'], 'Plan the migration')
    const title = titleNodeOf(row)
    expect(title?.textContent).toBe('Plan the migration')
  })

  it('resolves a session id by title reverse lookup', () => {
    const index = providerTitleIndex(listState([
      { id: 'a', title: 'Plan the migration', provider: 'codex', model: 'gpt-5-codex' },
      { id: 'b', title: 'Write tests', provider: 'claude', model: 'sonnet' },
    ]))
    const used = new Set<string>()
    const row = rowNode(['YDXeBa_sessionRow'], 'Write tests')
    expect(sessionIdOfRow(titleNodeOf(row), index, used)).toBe('b')
  })

  it('assigns duplicate titles to distinct rows within one pass', () => {
    const index = providerTitleIndex(listState([
      { id: 'x', title: 'Untitled', provider: 'deepseek', model: 'v4' },
      { id: 'y', title: 'Untitled', provider: 'grok', model: 'grok-4' },
    ]))
    const used = new Set<string>()
    const rowA = rowNode(['YDXeBa_sessionRow'], 'Untitled')
    const rowB = rowNode(['YDXeBa_sessionRow'], 'Untitled')
    const first = sessionIdOfRow(titleNodeOf(rowA), index, used)
    const second = sessionIdOfRow(titleNodeOf(rowB), index, used)
    expect(first !== undefined && second !== undefined).toBe(true)
    expect(first).not.toBe(second)
  })

  it('skips an unlocatable row (title not in the provider index)', () => {
    const index = providerTitleIndex(listState([
      { id: 'a', title: 'Known', provider: 'codex', model: 'gpt' },
    ]))
    const used = new Set<string>()
    const row = rowNode(['YDXeBa_sessionRow'], 'Unknown session')
    expect(sessionIdOfRow(titleNodeOf(row), index, used)).toBeUndefined()
  })

  it('can identify a blank row so a current selector value may decorate it', () => {
    const index = providerTitleIndex(listState([
      { id: 'blank', title: 'New Session', provider: null, model: '' },
    ]))
    const used = new Set<string>()
    const row = rowNode(['YDXeBa_sessionRow'], 'New Session')
    expect(sessionIdOfRow(titleNodeOf(row), index, used)).toBe('blank')
  })
})

describe('provider-map', () => {
  it('uses observed selector state before the last-request projection', () => {
    const list = listState([
      { id: 'a', title: 'A', provider: 'codex', model: 'gpt-5' },
      { id: 'b', title: 'B', provider: null, model: '' },
    ])
    const selected = new Map([
      ['a', { provider: 'deepseek-official', model: 'deepseek-v4' }],
      ['b', { provider: 'opencode', model: 'opencode-go' }],
    ])
    const map = providerBySession(list, selected)
    expect(map.get('a')).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4' })
    expect(map.get('b')).toEqual({ provider: 'opencode', model: 'opencode-go' })
    expect(map.size).toBe(2)
  })

  it('falls back to the durable last-request projection when selector state is unseen', () => {
    const list = listState([
      { id: 'a', title: 'A', provider: 'codex', model: 'gpt-5' },
      { id: 'b', title: 'B', provider: null, model: '' },
    ])
    const map = providerBySession(list)
    expect(map.get('a')).toEqual({ provider: 'codex', model: 'gpt-5' })
    expect(map.has('b')).toBe(false)
  })
})
