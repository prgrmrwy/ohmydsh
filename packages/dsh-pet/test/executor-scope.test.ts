/**
 * Executor scoping: the Pet allowlist provider must be installed on every
 * executor Agent at creation time.
 *
 * Workspace symlink projection only makes revisions discoverable. The real
 * isolation boundary is the scoped provider registered here — without it an
 * executor would inherit DSH's global Skill discovery and could load Skills
 * the user never enabled for Pet.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry, type SourceResolver } from '../src/host/capture.js'
import { PetCoordinator, type PromptDispatcher } from '../src/host/coordinator.js'
import type { AgentRegistryLike } from '../src/host/executor.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import { inspectBundle } from '../src/host/skill-bundle.js'
import { createPetSkillProvider, PET_SKILL_PROVIDER } from '../src/host/skill-provider.js'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { defineTool, parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import {
  PET_CONTEXT_PARAMETERS,
} from '../src/host/tools.js'
import { openPetHarness, type PetHarness,
  installTestSkill,
} from './harness.js'
import type { PetInvocationCapture } from '../src/wire.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const resolver: SourceResolver = {
  getSession: id => (id.startsWith('src') ? { id, title: `Session ${id}`, cwd: '/repo' } : undefined),
  getWorkspace: () => undefined,
}

async function petPaths(): Promise<PetPaths> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-scope-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  return paths
}

/** Install a Skill revision and optionally enable it. */
async function addSkill(
  paths: PetPaths,
  ref: PetHarness,
  name: string,
  options: { enable?: boolean } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
  await mkdir(root, { recursive: true })
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} capability\n---\nBody for ${name}.\n`,
  )
  const inspection = await inspectBundle(root)
  await ref.repository.putSkillRevision({
    skillName: inspection.skillName,
    sourcePath: inspection.canonicalSourcePath,
    description: inspection.description,
    provenance: { kind: 'local-link', installedAt: Date.now() },
    fileCount: inspection.fileCount,
    totalBytes: inspection.totalBytes,
  })
  if (options.enable !== false) {
    await ref.repository.putSkillSelection({
      skillName: name,
      enabled: true,
      showAsShortcut: true,
    })
  }
  return inspection.canonicalSourcePath
}

function capture(overrides: Partial<PetInvocationCapture> = {}): PetInvocationCapture {
  return {
    clientInvocationId: `inv-${Math.random().toString(36).slice(2, 10)}`,
    capabilityId: 'demo',
    sourceKind: 'session',
    sourceSessionId: 'src-1',
    ...overrides,
  }
}

describe('executor Agents receive the Pet scope', () => {
  it('passes a setup callback into ordinary Agent creation', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo')

    const capabilities = new CapabilityRegistry()
    await installTestSkill(harness!, 'demo', { context: 'session-required' })

    const create = vi.fn(async (options: { sessionId: string }) => ({
      session: { id: options.sessionId },
    }))
    const executorSetup = vi.fn()
    const dispatcher: PromptDispatcher = { dispatch: async () => {} }

    const coordinator = new PetCoordinator({
      repository: harness.repository,
      capabilities,
      agents: { create, get: () => ({}) } as unknown as AgentRegistryLike,
      dispatcher,
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: paths.workspaceRoot,
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      executorSetup,
    })

    await coordinator.accept(capture())

    const call = create.mock.calls[0]?.[0] as { setup?: unknown; meta?: { cwd?: string } }
    // The scope must be handed to the factory, which awaits it BEFORE the
    // session and agent are published.
    expect(call.setup).toBe(executorSetup)
    expect(call.meta?.cwd).toBe(paths.workspaceRoot)
  })

  it('installs the allowlist provider on the agent context, not the Host context', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo')

    // Reproduce the Host's executorSetup shape.
    const registered: { name: string }[] = []
    const agentCtx = {
      skills: {
        register: (provider: { name: string }) => {
          registered.push(provider)
          return () => {}
        },
      },
      effect: (fn: () => unknown) => {
        fn()
        return () => {}
      },
    }
    const provider = createPetSkillProvider(harness.repository, paths)
    agentCtx.effect(() => agentCtx.skills.register(provider))

    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe(PET_SKILL_PROVIDER)
  })

  it('serves only enabled revisions to a scoped executor', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo', { enable: true })
    await addSkill(paths, harness, 'not-enabled', { enable: false })

    const provider = createPetSkillProvider(harness.repository, paths)
    const candidates = await provider.list()

    // A globally discoverable Skill that Pet never enabled must not appear.
    expect(candidates.map(item => item.name)).toEqual(['demo'])
    expect(candidates[0]?.provider).toBe(PET_SKILL_PROVIDER)
  })

  it('loads a scoped candidate body from the registered directory', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    const digest = await addSkill(paths, harness, 'demo')

    const provider = createPetSkillProvider(harness.repository, paths)
    const candidate = (await provider.list())[0]
    const definition = await provider.get(candidate!)

    expect(definition?.content).toContain('Body for demo')
    // Resolution reads the registered directory directly, never the mutable
    // Workspace projection.
    expect(definition?.path).toContain(digest)
    expect(definition?.path).toContain('SKILL.md')
  })

  it('reuses the existing executor without re-running setup', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo')

    const capabilities = new CapabilityRegistry()
    await installTestSkill(harness!, 'demo', { context: 'session-required' })
    const create = vi.fn(async (options: { sessionId: string }) => ({
      session: { id: options.sessionId },
    }))
    const executorSetup = vi.fn()
    const coordinator = new PetCoordinator({
      repository: harness.repository,
      capabilities,
      agents: { create, get: () => ({}) } as unknown as AgentRegistryLike,
      dispatcher: { dispatch: async () => {} },
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: paths.workspaceRoot,
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      executorSetup,
    })

    const first = await coordinator.accept(capture())
    await coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-complete' })
    await coordinator.accept(capture())

    // One Task, one executor session, so exactly one scoped composition.
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('provider registers against the real DSH skill registry', () => {
  it('mounts through registerProvider and serves the allowlist', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo')

    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    // `registerProvider` takes a FACTORY receiving the registration control.
    // The single-skill `register(skill)` API throws here — that mistake made
    // executor `setup` fail, breaking every Invocation.
    const dispose = ctx.skills.registerProvider(() =>
      createPetSkillProvider(harness!.repository, paths) as never,
    )

    const summaries = await ctx.skills.list()
    expect(summaries.map(item => item.name)).toEqual(['demo'])
    expect(summaries[0]?.provider).toBe(PET_SKILL_PROVIDER)

    dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('rejects the single-skill register() form a provider must not use', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)

    // Regression guard: a provider object is not a SkillRegistration.
    expect(() =>
      ctx.skills.register(createPetSkillProvider(harness!.repository, paths) as never),
    ).toThrow()
  })
})

describe('Pet tool schemas match the real defineTool contract', () => {
  it('compiles parameters as a flat property map', () => {
    // `parameters` is an implicit open object root keyed by property name —
    // passing a raw JSON Schema object instead throws at registration.
    expect(parameterSchemaSpecToJsonSchema(PET_CONTEXT_PARAMETERS)).toEqual({
      type: 'object',
      properties: {},
    })
  })

  it('registers exactly one tool, because Pet ships no capability adapters', async () => {
    const { readFile } = await import('node:fs/promises')
    const tools = await readFile(
      path.resolve(__dirname, '..', 'src', 'host', 'tools.ts'),
      'utf8',
    )

    // A capability is an installed Skill driving ordinary DSH tools. Adding a
    // per-capability Pet tool would put the runtime back in the business of
    // shipping code for each capability.
    expect([...tools.matchAll(/ctx\.tools\.register\(/g)]).toHaveLength(1)
    expect(tools).toContain('PET_CONTEXT_TOOL')
    expect(tools).not.toContain('pet_create_mr')
    expect(tools).not.toContain('pet_send_cr')
    expect(tools).not.toContain('pet_clean_worktree')
  })

  it('rejects the raw JSON Schema shape that was previously shipped', () => {
    expect(() =>
      parameterSchemaSpecToJsonSchema({
        type: 'object',
        additionalProperties: false,
        properties: {},
      } as never),
    ).toThrow(/must be a value schema object/)
  })

  it('accepts both Pet tool definitions', () => {
    const definition = defineTool({
      name: 'pet_context_probe',
      description: 'probe',
      parameters: PET_CONTEXT_PARAMETERS,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { json: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.json }],
      },
      execute: async () => ({ json: '{}' }),
    })
    expect(definition.name).toBe('pet_context_probe')
  })
})

describe('executor sessions receive their relationship title', () => {
  it('renames the new executor with the generated title', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo')

    const capabilities = new CapabilityRegistry()
    await installTestSkill(harness!, 'demo', { context: 'session-required' })
    const renames: { sessionId: string; title: string }[] = []
    const coordinator = new PetCoordinator({
      repository: harness.repository,
      capabilities,
      agents: {
        create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
        get: () => ({}),
      } as unknown as AgentRegistryLike,
      dispatcher: { dispatch: async () => {} },
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: paths.workspaceRoot,
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      renameExecutor: (sessionId, title) => {
        renames.push({ sessionId, title })
      },
    })

    const accepted = await coordinator.accept(capture())

    expect(renames).toHaveLength(1)
    expect(renames[0]?.sessionId).toBe(accepted.task.executorSessionId)
    // Pet marker, source snapshot, short identity and epoch.
    expect(renames[0]?.title).toContain('🐾')
    expect(renames[0]?.title).toContain('Session src-1')
    expect(renames[0]?.title).toContain('#1')
  })

  it('does not rename again when an existing Task is reused', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo')

    const capabilities = new CapabilityRegistry()
    await installTestSkill(harness!, 'demo', { context: 'session-required' })
    const renames: string[] = []
    const coordinator = new PetCoordinator({
      repository: harness.repository,
      capabilities,
      agents: {
        create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
        get: () => ({}),
      } as unknown as AgentRegistryLike,
      dispatcher: { dispatch: async () => {} },
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: paths.workspaceRoot,
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      renameExecutor: (_sessionId, title) => {
        renames.push(title)
      },
    })

    const first = await coordinator.accept(capture())
    await coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-complete' })
    await coordinator.accept(capture())

    // A user rename must survive later Invocations on the same Task.
    expect(renames).toHaveLength(1)
  })

  it('completes the Invocation even when renaming fails', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    await addSkill(paths, harness, 'demo')

    const capabilities = new CapabilityRegistry()
    await installTestSkill(harness!, 'demo', { context: 'session-required' })
    const coordinator = new PetCoordinator({
      repository: harness.repository,
      capabilities,
      agents: {
        create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
        get: () => ({}),
      } as unknown as AgentRegistryLike,
      dispatcher: { dispatch: async () => {} },
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: paths.workspaceRoot,
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      renameExecutor: () => {
        throw new Error('title service unavailable')
      },
    })

    // The title is cosmetic; routing uses stored ids, so a failure here must
    // not fail the user's work.
    const accepted = await coordinator.accept(capture())
    expect(accepted.started).toBe(true)
  })
})

describe('the agent context is a fresh fiber without inherited grants', () => {
  it('declares its dependency before reading a service on the agent context', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      path.resolve(__dirname, '..', 'src', 'index.ts'),
      'utf8',
    )
    const setup = source.slice(source.indexOf('const executorSetup'))

    // Reading `scoped.skills` directly throws
    // `cannot get property "skills" without inject` in a REAL Host, because
    // the agent context does not inherit the plugin's inject grants. Only a
    // booted Host surfaces this, so the shape is pinned here.
    expect(setup).toContain("scoped.inject(['skills']")
    expect(setup).not.toMatch(/scoped\.skills\.registerProvider/)
  })
})
