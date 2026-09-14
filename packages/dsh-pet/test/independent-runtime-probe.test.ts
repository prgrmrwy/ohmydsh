import { spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Opt-in, helper-level G1 evidence, NOT full child/Host acceptance.
 * DSH_PET_TEST_RUNTIME must name the reviewed launcher root (not node_modules).
 * Native Node imports keep Vitest from substituting the workspace's dependencies.
 * No Agent/session, provider request, network, or production home is used. Only
 * temporary empty preset fixtures and real Cordis/AgentPresets scopes are made.
 * Cold setup deliberately records the current mismatch, not a passing G1 claim.
 */
const runtime = process.env.DSH_PET_TEST_RUNTIME

const probe = String.raw`
import { readFile, realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = await realpath(process.env.DSH_PET_TEST_RUNTIME);
if (basename(root) !== 'eb586fe8ead9f58d0e54a8a2f527c2947acf1c1d685a9e78330716cb81b653d5-58844649-a3be-4ae2-b6c1-aa63ebcacbca') {
  throw Error('Not the reviewed immutable launcher build');
}
const versions = {
  dsh: '0.1.2-rc.1',
  cordis: '4.0.2',
  'cordis-plugin-loader': '1.0.3',
  'dsh-subagent': '0.1.2-rc.1-locus-settlement-notice.1',
  'dsh-subagent-spawn-in-process': '0.1.2-rc.1',
  'dsh-agent-presets': '0.1.2-rc.1',
  'dsh-scope': '0.1.2-rc.1',
};
const entries = {};
for (const [name, version] of Object.entries(versions)) {
  const directory = await realpath(join(root, 'node_modules/@deepseek-ai', name));
  const rel = relative(root, directory);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Package escapes fixed runtime: ' + name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/' + name || manifest.version !== version) {
    throw Error('Unreviewed runtime package: ' + name + '@' + manifest.version);
  }
  if (name === 'dsh-subagent' && (
    manifest.dsh_compat?.upstreamBase !== 'a66e4702047846cdaa10c66c9d3df3951f5ea70d' ||
    manifest.dsh_compat?.patchSha256 !== '97ef5189f726799c13bdd7622aa37292a7451fe13981fac77de4d82161e14b28'
  )) throw Error('Unreviewed Subagent compatibility provenance');
  if (name !== 'dsh') entries[name] = pathToFileURL(join(directory, manifest.main)).href;
}
const subagent = await import(entries['dsh-subagent']);
const spawn = await import(entries['dsh-subagent-spawn-in-process']);
let provider;
spawn.apply({ subagents: { registerProvider(value) { provider = value; } } }, { providerName: 'spawn' });
const parentSeed = [{ type: 'assistant/message', data: { privateSentinel: 'PARENT_ONLY_77_TURNS' } }];
const seedParent = {
  session: { snapshotEvents() { throw Error('spawn prepare read parent history'); } },
};
const prepared = await provider.prepareContinuable({ parent: seedParent, seed: parentSeed });

let requestConfig = { provider: 'creation-provider', model: 'creation-model', reasoningEffort: 'high' };
const modelParent = {
  options: { provider: 'stale-provider', model: 'stale-model', maxTokens: 8192 },
  session: { requestHeader: () => ({ config: requestConfig }) },
};
const captured = subagent.resolveChildAgentOptions(modelParent, undefined, 1);
requestConfig = { provider: 'later-provider', model: 'later-model', reasoningEffort: 'low' };
const pinned = subagent.resolveChildAgentOptions(modelParent, captured, 1);
const routeOverride = subagent.resolveChildAgentOptions(modelParent, { provider: 'other', model: 'other-model' }, 1);

const home = await mkdtemp(join(tmpdir(), 'pet-independent-probe-'));
// Set before loading the preset service, and disable its implicit home roots.
process.env.DSH_HOME = home;
let ctx;
try {
  const { Context } = await import(entries.cordis);
  const { AgentPresets } = await import(entries['dsh-agent-presets']);
  const { createScope } = await import(entries['dsh-scope']);
  const presetsRoot = join(home, 'presets');
  for (const name of ['before', 'after']) {
    await mkdir(join(presetsRoot, name), { recursive: true });
    await writeFile(join(presetsRoot, name, 'agent.cordis.yml'), '[]\n');
  }
  ctx = new Context();
  ctx.baseUrl = pathToFileURL(root + '/').href;
  const { Loader } = await import(entries['cordis-plugin-loader']);
  new Loader(ctx, { baseUrl: ctx.baseUrl });
  // Projection registration and prompt sink are inert boundary doubles; preset
  // discovery, mounting, scope binding and composeFrom are actual runtime code.
  ctx.provide('sessionProjections', { register() {} });
  ctx.provide('systemPrompt', { context() {}, getContextOrder() { return 0; } });
  const presets = new AgentPresets(ctx, {
    roots: [{ path: presetsRoot, trust: 'system' }],
    includeShippedRoot: false, includeUserRoot: false, default: 'before',
  });
  const parentScope = createScope(ctx, {});
  const warmScope = createScope(ctx, {});
  const coldScope = createScope(ctx, {});
  await presets.mount(parentScope.ctx, 'before');
  const parent = { ctx: parentScope.ctx, session: { header: { id: 'fixture-parent', cwd: home } } };
  const savedHeader = subagent.childSessionMeta(parent, 1, false);
  subagent.applyChildComposition(warmScope.ctx, parent, {});
  const warmPreset = presets.composedPreset(warmScope.ctx);
  // Same operation used by ContinuationManager.materializeTracked on resume.
  // No session is created here: the saved child header is only fixture state.
  await presets.recompose(parentScope.ctx, 'after');
  coldScope.ctx.provide('agent', { session: { header: savedHeader } });
  subagent.applyChildComposition(coldScope.ctx, parent, {});
  const result = {
    versions, inheritsParentContext: provider.inheritsParentContext, prepared,
    captured, pinned, routeOverride,
    savedHeader, warmPreset, coldPreset: presets.composedPreset(coldScope.ctx),
    parentPreset: presets.composedPreset(parentScope.ctx),
    warmPresetAfterParentChange: presets.composedPreset(warmScope.ctx),
  };
  console.log('PET_INDEPENDENT_PROBE=' + JSON.stringify(result));
} finally {
  // Quiesce runtime scopes/standing preset trees before deleting their files.
  try {
    if (ctx) {
      await ctx.fiber.dispose();
      while (ctx.fiber.inertia !== undefined) await ctx.fiber.inertia;
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
`

type Evidence = {
  inheritsParentContext: boolean
  prepared: Record<string, unknown>
  captured: Record<string, unknown>
  pinned: Record<string, unknown>
  routeOverride: Record<string, unknown>
  savedHeader: { agentPreset: string; isSeeded: boolean; parentSession: string }
  warmPreset: string
  coldPreset: string
  parentPreset: string
  warmPresetAfterParentChange: string
}

describe.skipIf(runtime === undefined)('G1 fixed-runtime helper probe (opt in with DSH_PET_TEST_RUNTIME)', () => {
  let evidence: Evidence

  beforeAll(() => {
    if (runtime === undefined || !isAbsolute(runtime)) {
      throw new Error('DSH_PET_TEST_RUNTIME must be an absolute reviewed launcher root')
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      // Deliberately do not inherit production home, provider keys, NODE_OPTIONS,
      // or loader overrides. All package entry points are fixed absolute URLs.
      env: { DSH_PET_TEST_RUNTIME: runtime },
      encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024,
    })
    if (result.error || result.status !== 0) {
      throw new Error(`Fixed-runtime probe failed: ${result.error?.message ?? result.status}\n${result.stdout}\n${result.stderr}`)
    }
    const line = result.stdout.split('\n').find(value => value.startsWith('PET_INDEPENDENT_PROBE='))
    if (line === undefined) throw new Error(`Probe produced no evidence: ${result.stdout}`)
    evidence = JSON.parse(line.slice('PET_INDEPENDENT_PROBE='.length)) as Evidence
  }, 25_000)

  it('official spawn preparation returns no seed and never reads parent history', () => {
    expect(evidence.inheritsParentContext).toBe(false)
    expect(evidence.prepared).toEqual({})
  })

  it('official option resolver snapshots the current model and accepts explicit pinned overrides', () => {
    expect(evidence.captured).toEqual({
      provider: 'creation-provider', model: 'creation-model', reasoningEffort: 'high',
      maxTokens: 8192, subagentDepth: 1,
    })
    expect(evidence.pinned).toEqual(evidence.captured)
    expect(evidence.routeOverride).not.toHaveProperty('reasoningEffort')
  })

  it('DIAGNOSTIC: cold composition follows changed live parent, not saved child preset (G1 gap)', () => {
    expect(evidence.savedHeader).toMatchObject({
      agentPreset: 'before', isSeeded: false, parentSession: 'fixture-parent',
    })
    expect(evidence.warmPreset).toBe('before')
    expect(evidence.warmPresetAfterParentChange).toBe('before')
    expect(evidence.parentPreset).toBe('after')
    expect(evidence.coldPreset).toBe('after')
    expect(evidence.coldPreset).not.toBe(evidence.savedHeader.agentPreset)
  })
})
