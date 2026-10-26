// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ModelSelect } from '#model-source/client/ui-model-selection/src/client/ModelSelect.tsx'
import { en } from '#model-source/client/ui-model-selection/src/client/locales.ts'
import { filterOptions } from '#model-source/client/ui-commands/src/client/popup.ts'

const reasoning = { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium' }
const groups = [{ id: 'gateway', name: 'Gateway', models: [
  { id: 'codex/gpt', name: 'GPT', reasoning, displayGroup: { id: 'codex', label: 'Magpie · Codex' } },
  { id: 'claude/opus', name: 'Opus', reasoning, displayGroup: { id: 'claude', label: 'Magpie · Claude' } },
  { id: 'gemini/pro', name: 'Gemini', displayGroup: { id: 'gemini', label: 'Magpie · Gemini' } },
  { id: 'plain', name: 'Plain' },
  { id: 'second', name: 'Second', displayGroup: { id: 'codex', label: 'Magpie · Codex' } },
] }, { id: 'ordinary', name: 'Ordinary', models: [{ id: 'codex/gpt', name: 'Local GPT', displayGroup: { id: 'codex', label: 'Local · Codex' } }] }]
const next = { provider: 'gateway', model: 'codex/gpt', reasoningEffort: 'medium' }
const t = (key: string, params?: Record<string, string>) => (en[key as keyof typeof en] ?? key).replace(/\{(\w+)\}/g, (match, name) => params?.[name] ?? match)
function setup(overrides = {}) {
  const initial = { current: next, groups, failures: [], status: 'ready', pending: null, error: null, routable: true, ...overrides }
  const directory = createSnapshotStore(initial)
  const select = vi.fn(async (selection) => { directory.set({ ...initial, current: selection }); return { ok: true, value: undefined } })
  render(<ModelSelect locked={false} available directory={directory} select={select} load={vi.fn()} t={t} />)
  const trigger = screen.getByRole('button', { name: /Select model, current/ })
  const openModels = () => { fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: /^Model/ })) }
  return { directory, select, trigger, openModels }
}
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(cleanup)

it('renders distinct display buckets without changing real providers or model names; click keeps route and effort selection', async () => {
  const b = setup(); b.openModels()
  for (const label of ['Magpie · Codex', 'Magpie · Claude', 'Magpie · Gemini', 'Gateway', 'Local · Codex']) expect(screen.getByText(label)).toBeTruthy()
  expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['GPT', 'Second', 'Opus', 'Gemini', 'Plain', 'Local GPT'])
  expect(screen.getByRole('menuitemradio', { name: 'GPT' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Opus' }))
  await waitFor(() => expect(b.select).toHaveBeenCalledWith({ provider: 'gateway', model: 'claude/opus' }))
  fireEvent.click(b.trigger); fireEvent.click(screen.getByRole('menuitem', { name: /^Effort/ }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
  await waitFor(() => expect(b.select).toHaveBeenLastCalledWith({ provider: 'gateway', model: 'claude/opus', reasoningEffort: 'high' }))
})

it.each(['codex', 'codex/gpt', 'GPT', 'Magpie · Claude'])('searches group label, model id and name (%s) while keyboard accepts true identity', async (query) => {
  const b = setup(); b.openModels()
  const input = screen.getByRole('searchbox')
  fireEvent.change(input, { target: { value: query } })
  expect(screen.getAllByRole('menuitemradio').length).toBeGreaterThan(0)
  expect(document.activeElement).toBe(input)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  if (b.select.mock.calls.length) expect(['gateway', 'ordinary']).toContain(b.select.mock.calls[0]![0].provider)
  await waitFor(() => expect(b.trigger.getAttribute('aria-expanded')).toBe('false'))
})

it('accepts exactly the highlighted Second model after ArrowDown across codex display groups', async () => {
  const b = setup(); b.openModels()
  const input = screen.getByRole('searchbox')
  fireEvent.change(input, { target: { value: 'codex' } })
  expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['GPT', 'Second', 'Local GPT'])
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  const highlighted = screen.getAllByRole('menuitemradio').filter(row => row.hasAttribute('data-highlighted'))
  expect(highlighted).toEqual([screen.getByRole('menuitemradio', { name: 'Second' })])
  expect(input.getAttribute('aria-activedescendant')).toBe(highlighted[0]!.id)
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => {
    expect(b.select.mock.calls).toEqual([[{ provider: 'gateway', model: 'second' }]])
    expect(b.trigger.getAttribute('aria-expanded')).toBe('false')
  })
})

it('preserves Tab acceptance, Escape/back and Shift+Tab focus paths with filtered display groups', async () => {
  const b = setup(); b.openModels()
  const input = screen.getByRole('searchbox')
  fireEvent.change(input, { target: { value: 'Magpie · Claude' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('searchbox')).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: /^Model/ }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Magpie · Claude' } })
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Tab' })
  await waitFor(() => expect(b.select).toHaveBeenCalledWith({ provider: 'gateway', model: 'claude/opus' }))
  b.openModels()
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Tab', shiftKey: true })
  expect(screen.getByRole('menuitem', { name: /^Model/ })).toBe(document.activeElement)
})

it('visibly shows actual effort and next intent without mutating either; effort checks still use next', async () => {
  const actual = { ...next, reasoningEffort: 'high' }
  const b = setup({ lastUsed: actual })
  expect(b.trigger.textContent).toContain('Last used: High · Next: Medium')
  fireEvent.click(b.trigger)
  expect(screen.getByRole('menuitem', { name: /^Effort/ }).textContent).toContain('Last used: High · Next: Medium')
  fireEvent.click(screen.getByRole('menuitem', { name: /^Effort/ }))
  expect(screen.getByRole('menuitemradio', { name: 'Medium' }).getAttribute('aria-checked')).toBe('true')
  expect(b.select).not.toHaveBeenCalled()
  act(() => b.directory.set({ ...b.directory.getSnapshot(), current: { ...next, reasoningEffort: 'low' } }))
  expect(b.trigger.textContent).toContain('Last used: High · Next: Low')
  expect(b.directory.getSnapshot().lastUsed).toEqual(actual)
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
  await waitFor(() => expect(b.select).toHaveBeenCalledWith(actual))
})

it('leaves ordinary matching efforts and different-route intents unchanged', () => {
  const b = setup({ lastUsed: { ...next } })
  expect(b.trigger.textContent).not.toContain('Last used:')
  act(() => b.directory.set({ ...b.directory.getSnapshot(), lastUsed: { ...next, provider: 'other', reasoningEffort: 'high' } }))
  expect(b.trigger.textContent).not.toContain('Last used:')
})

it('popup fuzzy search uses optional aliases without replacing labels or changing ordinary commands', () => {
  const option = { id: 'gateway/codex/gpt', label: 'GPT', searchText: 'Magpie · Codex GPT codex/gpt' }
  for (const query of ['codex', 'codex/gpt', 'GPT']) expect(filterOptions([option], query, 'fuzzy-label')).toEqual([option])
  const ordinary = { id: 'plain', label: 'Plain' }
  expect(filterOptions([ordinary], 'xyz', 'fuzzy-label')).toEqual([])
  expect(filterOptions([ordinary], 'pl', 'fuzzy-label')).toEqual([ordinary])
  expect(option.label).toBe('GPT')
})
