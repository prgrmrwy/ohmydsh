import { readFile } from 'node:fs/promises'
import nodePath from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  attestLocusComposition,
  composeLocusChild,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_DELEGATION_DENYLIST,
  LOCUS_SAFE_TOOL_NAMES,
  LOCUS_SHELL_TIER_TOOL_NAMES,
} from '../src/host/locus/composition.js'
import {
  areLocusPresetsDeclared,
  isLocusPresetDeclared,
  LOCUS_BASE_PRESET,
  LOCUS_CHILD_PRESET,
  LocusPresetMissingError,
  mountLocusPreset,
} from '../src/host/locus/preset.js'
import { LOCUS_BASE_TOOL_FILTER } from '../src/host/locus/child.js'

const REPO = nodePath.resolve(import.meta.dirname, '../../..')

interface PresetRow {
  readonly id: string
  readonly name: string
  readonly disabled: boolean
  readonly text: string
}

/** The rows of a preset file with their raw text; a row ends where the next top-level row begins. */
async function readPresetRows(presetId: string): Promise<PresetRow[]> {
  const source = await readFile(nodePath.join(REPO, 'presets', presetId, 'agent.cordis.yml'), 'utf8')
  const rows: PresetRow[] = []
  const starts = [...source.matchAll(/^(\s*)- id: (\S+)$/gm)]
  starts.forEach((match, index) => {
    const end = starts[index + 1]?.index ?? source.length
    const text = source.slice(match.index ?? 0, end)
    const name = text.match(/^\s+name:\s*'?([^'\n]+)'?\s*$/m)?.[1]?.trim() ?? ''
    const platformRule = text.match(/disabled:\s*!!js process\.platform\s*([!=]==?)\s*['"]([^'"]+)['"]/)
    const disabled = platformRule === null
      ? /^\s+disabled:\s*true\s*$/m.test(text)
      : platformRule[1]!.startsWith('=')
        ? process.platform === platformRule[2]
        : process.platform !== platformRule[2]
    rows.push({ id: match[2]!, name, disabled, text })
  })
  return rows
}

/** Which model-facing tool names each mounted preset row contributes. */
const ROW_TOOLS: Readonly<Record<string, readonly string[]>> = {
  'tool-fs': ['read', 'read_image', 'write', 'edit'],
  'tool-fs-search': ['glob', 'grep'],
  'tool-web': ['web_search'],
  'tool-bash': ['bash'],
  'tool-skill': ['skill'],
}

/** A row's declaration without comments or blank lines, so banners between rows do not count. */
function withoutComments(text: string): string {
  return text.split('\n').filter(line => line.trim() !== '' && !line.trim().startsWith('#')).join('\n')
}

/** `tool-fs` registers each of its tools unless its row switches that tool off. */
const FS_TOOL_FLAGS: Readonly<Record<string, string>> = { read: 'read', read_image: 'readImage', write: 'write', edit: 'edit' }

function mountedToolNames(rows: readonly PresetRow[]): string[] {
  return rows.filter(row => !row.disabled).flatMap(row => {
    const names = ROW_TOOLS[row.id] ?? []
    if (row.id !== 'tool-fs') return names
    return names.filter(name => !new RegExp(`^\\s+${FS_TOOL_FLAGS[name]}:\\s*false\\s*$`, 'm').test(row.text))
  })
}

function fakePresets(declared: readonly string[]) {
  const mount = vi.fn(async (_ctx: unknown, id: string) => {
    if (!declared.includes(id)) throw new Error(`unknown preset ${id}`)
    return { id }
  })
  return {
    defaultId: 'standard',
    list: vi.fn(async () => declared.map(id => ({ id, name: id }))),
    mount,
  }
}

describe('locus-base 不含委派', () => {
  it('locus-base 不含委派', async () => {
    const rows = await readPresetRows(LOCUS_BASE_PRESET)
    expect(rows.length).toBeGreaterThan(0)

    // No row of the whitelist preset may load a delegation, workflow or
    // agent-control package, enabled or not: a disabled row is one edit away.
    for (const row of rows) {
      expect(row.name, `row ${row.id}`).not.toMatch(
        /dsh-tool-subagent|dsh-tool-workflow|dsh-tool-ralph|workflow-ptc|dsh-tool-jobs|dsh-tool-send-message/,
      )
      expect(row.id, `row ${row.id}`).not.toMatch(/subagent|workflow|ralph|send-message|jobs|list-agents/)
    }

    const tools = mountedToolNames(rows)
    for (const name of LOCUS_DELEGATION_DENYLIST) expect(tools).not.toContain(name)
    // The reviewed tiers must all be mountable, so the preset is a true ceiling.
    for (const name of [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_SHELL_TIER_TOOL_NAMES]) {
      expect(tools, `tool ${name}`).toContain(name)
    }
  })

  it('is a whitelist, neutral in name and independent of any channel', async () => {
    const rows = await readPresetRows(LOCUS_BASE_PRESET)
    const meta = await readFile(nodePath.join(REPO, 'presets', LOCUS_BASE_PRESET, 'preset.yml'), 'utf8')
    expect(LOCUS_BASE_PRESET).toBe('locus-base')
    expect(`${meta}${rows.map(row => row.text).join('\n')}`.toLowerCase()).not.toMatch(/lark|feishu|\bpet\b/)
    // Whitelist: it never carries the plan-mode or goal machinery of `standard`.
    expect(rows.map(row => row.id)).not.toContain('planning')
    expect(rows.map(row => row.id)).not.toContain('tool-goal')
  })

  it('is declared in the manifest so the runtime can mount it by id', async () => {
    const manifest = await readFile(nodePath.join(REPO, 'dsh.yaml'), 'utf8')
    expect(manifest).toMatch(/- id: locus-base\n\s+type: preset\n\s+version: \S+\n\s+enabled: true/)
    const version = (await readFile(nodePath.join(REPO, 'presets', LOCUS_BASE_PRESET, 'VERSION'), 'utf8')).trim()
    expect(manifest).toContain(`- id: locus-base\n    type: preset\n    version: ${version}`)
  })
})

describe('locus-child 以声明式 preset 表达子会话工具上限', () => {
  it('registers exactly the reviewed ceiling: the old allow list, nothing else', async () => {
    const rows = await readPresetRows(LOCUS_CHILD_PRESET)
    const tools = mountedToolNames(rows).sort()
    // The old persisted filter was `allow: safe + shell tier`; the preset now
    // registers exactly those names, and the filter is what Pet re-applies.
    expect(tools).toEqual([...LOCUS_BASE_TOOL_FILTER.allow!].sort())
    for (const name of ['write', 'edit', ...LOCUS_DELEGATION_DENYLIST]) expect(tools).not.toContain(name)
    for (const row of rows) {
      expect(row.name, `row ${row.id}`).not.toMatch(
        /dsh-tool-subagent|dsh-tool-workflow|dsh-tool-ralph|workflow-ptc|dsh-tool-jobs|dsh-tool-send-message|skill-filesystem/,
      )
      expect(row.id, `row ${row.id}`).not.toMatch(/subagent|workflow|ralph|send-message|jobs|list-agents|planning|goal/)
    }
  })

  it('is locus-base with only the tool-fs row made read-only (the locus main keeps its wider base)', async () => {
    const base = await readPresetRows(LOCUS_BASE_PRESET)
    const child = await readPresetRows(LOCUS_CHILD_PRESET)
    expect(child.map(row => row.id)).toEqual(base.map(row => row.id))
    for (const [index, row] of child.entries()) {
      if (row.id === 'tool-fs') continue
      expect(withoutComments(row.text), `row ${row.id}`).toBe(withoutComments(base[index]!.text))
    }
    // Control: the base preset really does register the file-writing tools, so
    // the read-only row is what the child's ceiling rests on.
    expect(mountedToolNames(base)).toEqual(expect.arrayContaining(['write', 'edit']))
    expect(child.find(row => row.id === 'tool-fs')!.text).toMatch(/write:\s*false[\s\S]*edit:\s*false/)
  })

  it('is neutral, declared in the manifest, and versioned with its file', async () => {
    const rows = await readPresetRows(LOCUS_CHILD_PRESET)
    const meta = await readFile(nodePath.join(REPO, 'presets', LOCUS_CHILD_PRESET, 'preset.yml'), 'utf8')
    expect(LOCUS_CHILD_PRESET).toBe('locus-child')
    expect(`${meta}${rows.map(row => row.text).join('\n')}`.toLowerCase()).not.toMatch(/lark|feishu|\bpet\b/)
    const manifest = await readFile(nodePath.join(REPO, 'dsh.yaml'), 'utf8')
    const version = (await readFile(nodePath.join(REPO, 'presets', LOCUS_CHILD_PRESET, 'VERSION'), 'utf8')).trim()
    expect(manifest).toContain(`- id: locus-child\n    type: preset\n    version: ${version}\n    enabled: true`)
  })

  it('both presets must be declared before a locus is created; a missing one is never replaced', async () => {
    const onlyMain = fakePresets([LOCUS_BASE_PRESET, 'standard'])
    const onlyChild = fakePresets([LOCUS_CHILD_PRESET, 'standard'])
    const both = fakePresets([LOCUS_BASE_PRESET, LOCUS_CHILD_PRESET])
    expect(await areLocusPresetsDeclared(onlyMain)).toBe(false)
    expect(await areLocusPresetsDeclared(onlyChild)).toBe(false)
    expect(await areLocusPresetsDeclared(both)).toBe(true)
    expect(await isLocusPresetDeclared(onlyChild, LOCUS_CHILD_PRESET)).toBe(true)
    expect(await areLocusPresetsDeclared({ list: async () => { throw new Error('catalog offline') } })).toBe(false)
    expect(new LocusPresetMissingError('x', { presetId: LOCUS_CHILD_PRESET })).toMatchObject({ presetId: LOCUS_CHILD_PRESET })
  })
})

describe('运行体只接受声明式 preset 时冷恢复 locus child', () => {
  it('运行体只接受声明式 preset 时冷恢复 locus child', async () => {
    const rows = await readPresetRows(LOCUS_BASE_PRESET)
    // The runtime only knows presets declared in the profile configuration.
    const presets = fakePresets([LOCUS_BASE_PRESET, 'standard'])
    const agentContext = { scope: 'locus-main' }

    // Host restart: the locus main is resumed and re-mounts its declared preset.
    await mountLocusPreset(presets, agentContext as never)
    expect(presets.mount).toHaveBeenCalledTimes(1)
    expect(presets.mount).toHaveBeenCalledWith(agentContext, LOCUS_BASE_PRESET)

    // The child is rebuilt from the parent's composition: its surface is the
    // preset ceiling, identical before and after the restart.
    const surface = [...mountedToolNames(rows), ...LOCUS_CALLER_BOUND_TOOLS]
      .filter(name => ![...LOCUS_DELEGATION_DENYLIST, 'write', 'edit'].includes(name))
    const compose = () => composeLocusChild(
      { id: 'child-1', scope: { get: () => ({}) } },
      {
        parentPreset: () => LOCUS_BASE_PRESET,
        childPreset: () => 'locus-child',
        lookup: {
          find: () => ({
            parentSessionId: 'main-1',
            childSessionId: 'child-1',
            locusId: 'locus-1',
            generation: 1,
            permission: 'read',
            childComposition: 'tier3',
            toolTier: { desired: 'safe', effective: 'safe' },
          }),
        },
        surface: {
          install: vi.fn(),
          setToolTier: vi.fn(),
          installOutboundGuard: vi.fn(),
          visibleTools: () => surface.filter(name => !LOCUS_SHELL_TIER_TOOL_NAMES.includes(name)),
        },
        policy: { apply: vi.fn(), resolve: () => 'read' },
      },
    )
    const before = compose()
    const after = compose()
    expect(before.composed).toBe(true)
    expect(after).toEqual(before)
    expect(attestLocusComposition(surface.filter(name => !LOCUS_SHELL_TIER_TOOL_NAMES.includes(name))).ok)
      .toBe(true)
  })
})

describe('preset 缺失', () => {
  it('preset 缺失', async () => {
    const presets = fakePresets(['standard', 'dsh-pet-executor'])

    await expect(mountLocusPreset(presets, {} as never)).rejects.toBeInstanceOf(LocusPresetMissingError)
    await expect(mountLocusPreset(presets, {} as never)).rejects.toMatchObject({
      code: 'locus-preset-missing',
      presetId: LOCUS_BASE_PRESET,
    })
    // Never falls back to another preset, declared or not.
    expect(presets.mount).not.toHaveBeenCalled()
  })

  it('treats an unreadable preset catalog as missing rather than assuming it', async () => {
    const presets = {
      defaultId: 'standard',
      list: vi.fn(async () => { throw new Error('catalog offline') }),
      mount: vi.fn(),
    }
    await expect(mountLocusPreset(presets, {} as never)).rejects.toBeInstanceOf(LocusPresetMissingError)
    expect(presets.mount).not.toHaveBeenCalled()
  })
})
