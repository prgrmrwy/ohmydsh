/**
 * Environment tab interaction, mounted for real.
 *
 * Rendered rather than source-asserted: a render crash blanks the tab and
 * silently stops every control, which reading the source cannot detect.
 *
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetSettingsSection } from '../src/client/settings.js'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** One env payload, replayed for every route. */
function stubEnv(data: {
  entries?: { scope: string; key: string; value: string; updatedAt: number }[]
  workspaces?: { id: string; title?: string; path?: string }[]
  globalScope?: string
  prefix?: string
}): { calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({
        url: String(url),
        body: init?.body === undefined ? undefined : JSON.parse(init.body),
      })
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            data: {
              entries: data.entries ?? [],
              workspaces: data.workspaces ?? [],
              globalScope: data.globalScope ?? 'global',
              prefix: data.prefix ?? 'DSH_PET_',
            },
          }),
      }
    }),
  )
  return { calls }
}

/** Reply with a Host rejection, as a failed validation would. */
function stubReject(message: string): void {
  let first = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (first) {
        first = false
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              ok: true,
              data: { entries: [], workspaces: [], globalScope: 'global', prefix: 'DSH_PET_' },
            }),
        }
      }
      return {
        status: 400,
        text: async () => JSON.stringify({ ok: false, error: 'BINDING_INVALID', message }),
      }
    }),
  )
}

async function mountEnv(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(createElement(PetSettingsSection, { initialTab: 'env' as const }))
  })
  return host
}

function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(item => item.textContent === label)
}

function inputs(host: HTMLElement): HTMLInputElement[] {
  return [...host.querySelectorAll('input')]
}

/** Drive a controlled React input. */
function type(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('the environment tab renders both scopes', () => {
  it('survives an empty payload', async () => {
    stubEnv({})

    const host = await mountEnv()

    expect(host.textContent).toContain('全局')
    expect(host.textContent).toContain('工作区')
    expect(host.textContent).toContain('尚未配置全局变量')
  })

  it('shows the injected name for each configured key', async () => {
    stubEnv({
      entries: [{ scope: 'global', key: 'CR_GROUP', value: 'oc_default_group', updatedAt: 1 }],
    })

    const host = await mountEnv()

    // The user must be able to copy the exact reference into a Skill.
    expect(host.textContent).toContain('$DSH_PET_CR_GROUP')
  })

  it('lets the global scope be edited without choosing a workspace', async () => {
    const { calls } = stubEnv({})

    const host = await mountEnv()
    const [keyField, valueField] = inputs(host)
    type(keyField!, 'CR_GROUP')
    type(valueField!, 'oc_new')
    await act(async () => {
      button(host, '添加')?.click()
    })

    const write = calls.find(call => call.url.endsWith('/env-mutate'))
    expect(write?.body).toMatchObject({
      scope: 'global',
      key: 'CR_GROUP',
      value: 'oc_new',
      action: 'set',
    })
  })
})

describe('values are masked until revealed', () => {
  it('masks a configured value and toggles it back', async () => {
    stubEnv({
      entries: [{ scope: 'global', key: 'CR_GROUP', value: 'oc_default_group', updatedAt: 1 }],
    })

    const host = await mountEnv()

    expect(host.textContent).not.toContain('oc_default_group')
    expect(host.textContent).toContain('•')

    await act(async () => {
      button(host, '显示')?.click()
    })
    expect(host.textContent).toContain('oc_default_group')

    await act(async () => {
      button(host, '隐藏')?.click()
    })
    expect(host.textContent).not.toContain('oc_default_group')
  })
})

describe('the override relationship is visible', () => {
  it('marks a workspace entry that shadows a global one', async () => {
    stubEnv({
      entries: [
        { scope: 'global', key: 'CR_GROUP', value: 'oc_default', updatedAt: 1 },
        { scope: 'ws-a', key: 'CR_GROUP', value: 'oc_project_a', updatedAt: 1 },
      ],
      workspaces: [{ id: 'ws-a', title: '项目A', path: '/work/a' }],
    })

    const host = await mountEnv()

    expect(host.textContent).toContain('覆盖全局')
  })

  it('lists the shadowed global entry in the effective view', async () => {
    stubEnv({
      entries: [
        { scope: 'global', key: 'CR_GROUP', value: 'oc_default', updatedAt: 1 },
        { scope: 'ws-a', key: 'CR_GROUP', value: 'oc_project_a', updatedAt: 1 },
      ],
      workspaces: [{ id: 'ws-a', title: '项目A', path: '/work/a' }],
    })

    const host = await mountEnv()

    // Hiding the loser would make the override invisible and leave "which
    // group does this actually post to" unanswerable at a glance.
    expect(host.textContent).toContain('生效结果')
    expect(host.textContent).toContain('已被覆盖')
    expect(host.textContent).toContain('来自工作区')
  })

  it('attributes an inherited value to the global scope', async () => {
    stubEnv({
      entries: [{ scope: 'global', key: 'NOTIFY_CHANNEL', value: 'oc_notify', updatedAt: 1 }],
      workspaces: [{ id: 'ws-a', title: '项目A' }],
    })

    const host = await mountEnv()

    expect(host.textContent).toContain('来自全局')
    expect(host.textContent).not.toContain('已被覆盖')
  })
})

describe('the workspace picker shows recognizable choices', () => {
  it('lists title and path rather than a bare id', async () => {
    stubEnv({ workspaces: [{ id: 'ws-1', title: '项目A', path: '/work/a' }] })

    const host = await mountEnv()
    const option = host.querySelector('option')

    expect(option?.textContent).toContain('项目A')
    expect(option?.textContent).toContain('/work/a')
  })
})

describe('a rejected write keeps the input', () => {
  it('shows the reason and preserves what was typed', async () => {
    stubReject('Environment variable name \'cr-group\' must be upper snake case, e.g. CR_GROUP')

    const host = await mountEnv()
    const [keyField, valueField] = inputs(host)
    type(keyField!, 'cr-group')
    type(valueField!, 'oc_x')
    await act(async () => {
      button(host, '添加')?.click()
    })

    expect(host.textContent).toContain('upper snake case')
    // Clearing on failure would make the user retype a value they cannot see.
    expect(keyField!.value).toBe('cr-group')
    expect(valueField!.value).toBe('oc_x')
  })
})

describe('the safety note is present', () => {
  it('warns that values reach the child environment', async () => {
    stubEnv({})

    const host = await mountEnv()

    expect(host.textContent).toContain('子进程环境')
    expect(host.textContent).toContain('不是凭据保管处')
  })
})
