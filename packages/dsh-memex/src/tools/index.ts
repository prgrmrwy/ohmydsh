import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { KernelResult, SearchHit } from '../run/types.js'
import { KernelError } from '../run/types.js'
import { installedKernelVersion, runKernel } from '../run/kernel.js'
import { parseList, parseSearch } from '../run/parse.js'
import type { ScopeResolution, ScopeService } from '../scope/types.js'
import { KERNEL_VERSION, TOOL_DESCRIPTIONS } from './descriptions.generated.js'
import { evaluateCrossWrite } from '../guard/index.js'

const DEFAULT_FANOUT_CONCURRENCY = 4
const MAX_SEARCH_RESULTS = 50
const SCOPE_DESCRIPTION = ' Scope selects the memory library: omit or use "current" for this session; search also accepts "all" or a list of scope names within the current readable binding.'
const WRITE_SCOPE_DESCRIPTION = ' Optional scope selects one or more additional writable libraries. The current library is written first; rejected additional targets do not roll back completed writes.'

export type KernelRunner = (args: readonly string[], options: { home: string; signal?: AbortSignal; stdin?: string }) => Promise<KernelResult>

export interface MemexToolOptions {
  readonly runner?: KernelRunner
  readonly fanoutConcurrency?: number
  readonly onToolSuccess?: (tool: 'recall' | 'retro' | 'write', session: object) => void
}

interface ToolExec {
  readonly agent?: { readonly session: { readonly header: { readonly cwd?: string } } }
  readonly signal?: AbortSignal
}

interface SearchSourceHit extends SearchHit {
  readonly scope: string
}

function outputSchema() {
  return {
    schema: {
      type: 'object' as const,
      additionalProperties: false as const,
      properties: { json: { type: 'string' as const, required: true as const } },
    },
    render: (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }],
  }
}

function currentFor(exec: ToolExec, resolver: ScopeService): ScopeResolution {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd === '') throw new Error('memex tools require exec.agent.session.header.cwd to resolve the current scope')
  return resolver.ensure(resolver.resolve(cwd))
}

function route(scope: ScopeResolution): { scope: string; home: string; created: boolean; notice?: string } {
  return {
    scope: scope.scope,
    home: scope.home,
    created: scope.created,
    ...(scope.created ? { notice: 'Created a new memory library; sync is not configured by dsh-memex.' } : {}),
  }
}

function failureMessage(result: KernelResult, operation: string, scope: string): string {
  return `memex ${operation} failed in scope ${scope} (exit ${result.exitCode})`
}

function requireSuccess(result: KernelResult, operation: string, scope: string): KernelResult {
  if (!result.ok) throw new KernelError('failed', failureMessage(result, operation, scope), result)
  return result
}

function bindingReadScopes(current: ScopeResolution, resolver: ScopeService): readonly string[] {
  return [...new Set(resolver.accessFor(current.scope).read)]
}

function selectedSearchScopes(
  requested: string | readonly string[] | undefined,
  current: ScopeResolution,
  resolver: ScopeService,
): ScopeResolution[] {
  const readable = bindingReadScopes(current, resolver)
  if (requested === undefined || requested === 'current') return [current]
  const names = requested === 'all'
    ? [...new Set([current.scope, ...readable])]
    : typeof requested === 'string'
      ? [requested]
      : requested.includes('all')
        ? (() => { throw new Error('memex_search scope lists must name concrete scopes; use scope: "all" by itself') })()
        : [...requested]
  /* current is intrinsically readable; bindings limit only additional scopes. */
  const unique = [...new Set(names.map(name => name === 'current' ? current.scope : name))]
  if (unique.length === 0) throw new Error('memex_search scope list must not be empty')
  for (const name of unique) {
    if (name !== current.scope && !readable.includes(name)) throw new Error(`Scope ${name} is outside the readable binding for current scope ${current.scope}`)
  }
  return unique.map(name => name === current.scope ? current : resolver.resolveByName(name))
    .sort((a, b) => a.scope.localeCompare(b.scope))
}

function selectedReadScope(requested: string | undefined, current: ScopeResolution, resolver: ScopeService): ScopeResolution {
  if (requested === undefined || requested === 'current' || requested === current.scope) return current
  const readable = bindingReadScopes(current, resolver)
  if (!readable.includes(requested)) throw new Error(`Scope ${requested} is outside the readable binding for current scope ${current.scope}`)
  return resolver.resolveByName(requested)
}


function requestedWriteScopes(requested: string | readonly string[] | undefined, current: ScopeResolution): string[] {
  const names = requested === undefined || requested === 'current' ? [] : typeof requested === 'string' ? [requested] : [...requested]
  return [...new Set(names)].filter(name => name !== 'current' && name !== current.scope)
}

function logGuardReject(ctx: Context, scope: string, rules: readonly string[]): void {
  // Deliberately log only identifiers — card text/title/slug commonly carry
  // business meaning and must not create a second leakage surface.
  ctx.logger('dsh-memex').warn('Cross-write rejected: scope=%s rules=%j', scope, rules)
}

function guardWrite(
  card: { slug: string; title?: string; body: string },
  target: ScopeResolution,
  resolver: ScopeService,
  onInactiveRule?: (rule: string) => void,
) {
  const decision = evaluateCrossWrite(card, target, resolver)
  for (const warning of decision.warnings) onInactiveRule?.(warning)
  return decision.allowed ? undefined : decision.rules
}

export async function mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('fanout concurrency must be a positive integer')
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async (): Promise<void> => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function searchArgs(args: { query?: string; limit?: number; list?: boolean; semantic?: boolean }): string[] {
  const result = ['search', '--limit', String(Math.min(Math.max(Math.trunc(args.limit ?? 10), 1), MAX_SEARCH_RESULTS))]
  if (args.list === true) result.push('--list')
  if (args.semantic === true) result.push('--semantic')
  if (args.query !== undefined && args.query !== '') result.push('--', args.query)
  return result
}

function syncConfig(home: string): { auto?: boolean; remote?: string } {
  try { return JSON.parse(readFileSync(join(home, '.sync.json'), 'utf8')) as { auto?: boolean; remote?: string } } catch { return {} }
}

async function syncHook(home: string, phase: 'fetch' | 'sync', runner: KernelRunner, signal?: AbortSignal): Promise<string | undefined> {
  const config = syncConfig(home)
  if (!config.remote || (phase === 'sync' && !config.auto)) return undefined
  const result = await runner(['sync', phase === 'fetch' ? 'pull' : 'push'], { home, ...(signal ? { signal } : {}) })
  return result.ok ? undefined : `memex ${phase} hook failed (exit ${result.exitCode})`
}

function enrichWriteContent(content: string, category?: string): string {
  if (!content.startsWith('---\n')) return content
  const end = content.indexOf('\n---\n', 4)
  if (end < 0) return content
  const head = content.slice(4, end)
  const body = content.slice(end + 5)
  const lines = head.split('\n')
  if (!lines.some(line => /^source\s*:/i.test(line))) lines.push('source: dsh')
  if (category && !lines.some(line => /^category\s*:/i.test(line))) lines.push(`category: ${JSON.stringify(category)}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

function frontmatterForRetro(args: { title: string; body: string; category?: string }): string {
  const today = new Date().toISOString().slice(0, 10)
  const escapedTitle = JSON.stringify(args.title)
  return [
    '---',
    `title: ${escapedTitle}`,
    `created: ${today}`,
    'source: dsh',
    ...(args.category === undefined ? [] : [`category: ${JSON.stringify(args.category)}`]),
    '---',
    args.body,
    '',
  ].join('\n')
}

async function writeCurrentAndAdditional(
  operation: 'write' | 'retro',
  args: { slug: string; content: string; scope: string | readonly string[] | undefined; title: string | undefined; body: string },
  current: ScopeResolution,
  resolver: ScopeService,
  runner: KernelRunner,
  signal: AbortSignal | undefined,
  ctx: Context,
) {
  const inactiveRules: string[] = []
  const noteInactive = (rule: string) => {
    if (!inactiveRules.includes(rule)) inactiveRules.push(rule)
    ctx.logger('dsh-memex').warn('Guard rule inactive: %s', rule)
  }
  const currentRules = guardWrite({ slug: args.slug, ...(args.title !== undefined ? { title: args.title } : {}), body: args.body }, current, resolver, noteInactive)
  if (currentRules) {
    logGuardReject(ctx, current.scope, currentRules)
    throw new Error(`Write rejected for scope ${current.scope}: ${currentRules.join(', ')}`)
  }
  const primaryWarnings: string[] = []
  if (operation === 'retro') {
    const warning = await syncHook(current.home, 'fetch', runner, signal)
    if (warning) primaryWarnings.push(warning)
  }
  const primary = requireSuccess(await runner(['write', '--', args.slug], { home: current.home, ...(signal !== undefined ? { signal } : {}), stdin: args.content }), operation, current.scope)
  const primarySyncWarning = await syncHook(current.home, 'sync', runner, signal)
  if (primarySyncWarning) primaryWarnings.push(primarySyncWarning)

  const writable = resolver.accessFor(current.scope).write
  const additional = [] as Array<{ scope: string; written: boolean; rules?: readonly string[]; error?: string; warning?: string }>
  for (const name of requestedWriteScopes(args.scope, current)) {
    if (!writable.includes(name)) {
      additional.push({ scope: name, written: false, error: `outside writable binding for ${current.scope}` })
      continue
    }
    let target: ScopeResolution
    try { target = resolver.ensure(resolver.resolveByName(name)) } catch {
      additional.push({ scope: name, written: false, error: 'unknown or invalid scope' })
      continue
    }
    const rules = guardWrite({ slug: args.slug, ...(args.title !== undefined ? { title: args.title } : {}), body: args.body }, target, resolver, noteInactive)
    if (rules) {
      logGuardReject(ctx, target.scope, rules)
      additional.push({ scope: target.scope, written: false, rules })
      continue
    }
    if (operation === 'retro') {
      const warning = await syncHook(target.home, 'fetch', runner, signal)
      if (warning) additional.push({ scope: target.scope, written: false, error: warning })
      if (warning) continue
    }
    const result = await runner(['write', '--', args.slug], { home: target.home, ...(signal !== undefined ? { signal } : {}), stdin: args.content })
    if (!result.ok) {
      additional.push({ scope: target.scope, written: false, error: `memex ${operation} failed (exit ${result.exitCode})` })
      continue
    }
    const syncWarning = await syncHook(target.home, 'sync', runner, signal)
    const warning = [result.stderr.trim() ? 'memex emitted a write warning' : '', syncWarning].filter(Boolean).join('; ')
    additional.push({ scope: target.scope, written: true, ...(warning ? { warning } : {}) })
  }
  return { primary, primaryWarnings, additional, inactiveRules }
}

export function registerMemexTools(ctx: Context, resolver: ScopeService, options: MemexToolOptions = {}): () => void {
  const runner = options.runner ?? runKernel
  const concurrency = options.fanoutConcurrency ?? DEFAULT_FANOUT_CONCURRENCY
  const installed = options.runner === undefined ? installedKernelVersion() : KERNEL_VERSION
  const kernelVersionWarning = installed === undefined
    ? 'memex CLI version could not be determined'
    : installed === KERNEL_VERSION ? undefined : `Tool adapter tested with memex ${KERNEL_VERSION}; installed ${installed}`
  const disposers: Array<() => void> = []

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_search',
    description: TOOL_DESCRIPTIONS.memex_search + SCOPE_DESCRIPTION,
    parameters: {
      query: { type: 'string', description: 'Search keywords (ranked OR).' },
      limit: { type: 'integer', description: `Max merged results (default 10, max ${MAX_SEARCH_RESULTS}).` },
      list: { type: 'boolean', description: 'When true with no query, list cards.' },
      semantic: { type: 'boolean', description: 'Use upstream embedding-based semantic search.' },
      scope: { oneOf: [
        { type: 'string', description: '"current", "all", or one readable scope name.' },
        { type: 'array', items: { type: 'string' }, description: 'Explicit readable scope names.' },
      ] },
    },
    output: outputSchema(),
    async execute(args, exec) {
      const current = currentFor(exec, resolver)
      const targets = selectedSearchScopes(args.scope, current, resolver)
      const outcomes = await mapConcurrent(targets, concurrency, async target => {
        try {
          const result = requireSuccess(await runner(searchArgs(args), { home: target.home, signal: exec.signal }), 'search', target.scope)
          const hits: SearchSourceHit[] = args.list === true && (args.query === undefined || args.query === '')
            ? parseList(result.stdout).map(hit => ({ ...hit, summary: '', scope: target.scope }))
            : parseSearch(result.stdout).map(hit => ({ ...hit, scope: target.scope }))
          return { target, hits }
        } catch (error) {
          if (exec.signal?.aborted === true) throw error
          return { target, hits: [] as SearchSourceHit[], error: error instanceof Error ? error.message : String(error) }
        }
      })
      const limit = Math.min(Math.max(Math.trunc(args.limit ?? 10), 1), MAX_SEARCH_RESULTS)
      const hits = outcomes.flatMap(item => item.hits).slice(0, limit)
      const failures = outcomes.flatMap(item => item.error === undefined ? [] : [{ scope: item.target.scope, error: item.error }])
      if (failures.length === targets.length) throw new Error(`memex search failed in every target scope: ${failures.map(item => `${item.scope}: ${item.error}`).join('; ')}`)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), targets: targets.map(route), hits, failures }, null, 2) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_read',
    description: TOOL_DESCRIPTIONS.memex_read + SCOPE_DESCRIPTION,
    parameters: {
      slug: { type: 'string', required: true, description: 'Card slug.' },
      scope: { type: 'string', description: 'A concrete readable scope name, or "current".' },
    },
    output: outputSchema(),
    async execute(args, exec) {
      const current = currentFor(exec, resolver)
      const target = selectedReadScope(args.scope, current, resolver)
      const result = await runner(['read', '--', args.slug], { home: target.home, signal: exec.signal })
      if (!result.ok) throw new KernelError('failed', `memex read failed for scope ${target.scope}, slug ${args.slug} (exit ${result.exitCode})`, result)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), target: route(target), slug: args.slug, content: result.stdout }, null, 2) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_recall',
    description: TOOL_DESCRIPTIONS.memex_recall,
    parameters: {
      query: { type: 'string', description: 'Keywords for ranked OR search. Omit to read the current library index.' },
      category: { type: 'string', description: 'Filter by category.' },
      tag: { type: 'string', description: 'Filter by tag.' },
      author: { type: 'string', description: 'Filter by author/source.' },
      since: { type: 'string', description: 'Only cards after YYYY-MM-DD.' },
      before: { type: 'string', description: 'Only cards before YYYY-MM-DD.' },
    },
    output: outputSchema(),
    async execute(args, exec) {
      const current = currentFor(exec, resolver)
      const filters: string[] = []
      for (const [flag, value] of [['category', args.category], ['tag', args.tag], ['author', args.author], ['since', args.since], ['before', args.before]] as const) {
        if (value !== undefined) filters.push(`--${flag}`, value)
      }
      let result: KernelResult
      let mode: 'search' | 'index' | 'list'
      if (args.query !== undefined && args.query !== '') {
        mode = 'search'
        result = await runner(['search', '--limit', '10', ...filters, '--', args.query], { home: current.home, signal: exec.signal })
      } else if (filters.length > 0) {
        mode = 'list'
        result = await runner(['search', '--limit', '10', '--list', ...filters], { home: current.home, signal: exec.signal })
      } else {
        mode = 'index'
        result = await runner(['read', '--', 'index'], { home: current.home, signal: exec.signal })
        if (!result.ok && /^Card not found: index\s*$/i.test(result.stderr.trim())) {
          mode = 'list'
          result = await runner(['search', '--limit', '10', '--list'], { home: current.home, signal: exec.signal })
        }
      }
      requireSuccess(result, 'recall', current.scope)
      if (exec.agent !== undefined) options.onToolSuccess?.('recall', exec.agent.session)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), mode, content: result.stdout || (mode === 'list' ? 'No cards yet.' : 'No cards found.') }, null, 2) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_write',
    description: TOOL_DESCRIPTIONS.memex_write + WRITE_SCOPE_DESCRIPTION,
    parameters: {
      slug: { type: 'string', required: true, description: 'Card slug in kebab-case.' },
      content: { type: 'string', required: true, description: 'Full card content: YAML frontmatter and markdown body.' },
      category: { type: 'string', description: 'Optional category; injected when absent from frontmatter.' },
      scope: { oneOf: [
        { type: 'string', description: 'One optional additional writable scope.' },
        { type: 'array', items: { type: 'string' }, description: 'Optional additional writable scopes.' },
      ], description: 'Current library is always written first.' },
    },
    output: outputSchema(),
    async execute(args, exec) {
      const current = currentFor(exec, resolver)
      const content = enrichWriteContent(args.content, args.category)
      const result = await writeCurrentAndAdditional('write', { slug: args.slug, content, scope: args.scope, title: undefined, body: content }, current, resolver, runner, exec.signal, ctx)
      if (exec.agent !== undefined) options.onToolSuccess?.('write', exec.agent.session)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), slug: args.slug, written: true, warning: [result.primary.stderr.trim() ? 'memex emitted a write warning' : '', ...result.primaryWarnings].filter(Boolean).join('; ') || undefined, ...(result.inactiveRules.length > 0 ? { guardWarnings: result.inactiveRules } : {}), additional: result.additional }, null, 2) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_retro',
    description: TOOL_DESCRIPTIONS.memex_retro + WRITE_SCOPE_DESCRIPTION,
    parameters: {
      slug: { type: 'string', required: true, description: 'Card slug in kebab-case.' },
      title: { type: 'string', required: true, description: 'Short card title.' },
      body: { type: 'string', required: true, description: 'Markdown body with wikilinks.' },
      category: { type: 'string', description: 'Optional category.' },
      scope: { oneOf: [
        { type: 'string', description: 'One optional additional writable scope.' },
        { type: 'array', items: { type: 'string' }, description: 'Optional additional writable scopes.' },
      ], description: 'Current library is always written first.' },
    },
    output: outputSchema(),
    async execute(args, exec) {
      const current = currentFor(exec, resolver)
      const content = frontmatterForRetro(args)
      const result = await writeCurrentAndAdditional('retro', { slug: args.slug, title: args.title, body: args.body, content, scope: args.scope }, current, resolver, runner, exec.signal, ctx)
      if (exec.agent !== undefined) options.onToolSuccess?.('retro', exec.agent.session)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), slug: args.slug, written: true, warning: [result.primary.stderr.trim() ? 'memex emitted a write warning' : '', ...result.primaryWarnings].filter(Boolean).join('; ') || undefined, ...(result.inactiveRules.length > 0 ? { guardWarnings: result.inactiveRules } : {}), additional: result.additional }, null, 2) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_links',
    description: TOOL_DESCRIPTIONS.memex_links,
    parameters: {
      slug: { type: 'string', description: 'Optional card slug; omit for graph statistics.' },
    },
    output: outputSchema(),
    async execute(args, exec) {
      const current = currentFor(exec, resolver)
      const command = args.slug === undefined ? ['links'] : ['links', '--', args.slug]
      const result = requireSuccess(await runner(command, { home: current.home, signal: exec.signal }), 'links', current.scope)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), content: result.stdout }, null, 2) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_archive',
    description: TOOL_DESCRIPTIONS.memex_archive,
    parameters: {
      slug: { type: 'string', required: true, description: 'Card slug to archive in the current scope.' },
    },
    output: outputSchema(),
    async execute(args, exec) {
      const current = currentFor(exec, resolver)
      const result = requireSuccess(await runner(['archive', '--', args.slug], { home: current.home, signal: exec.signal }), 'archive', current.scope)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), slug: args.slug, archived: true, warning: result.stderr.trim() ? 'memex emitted a warning' : undefined }, null, 2) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memex_organize',
    description: TOOL_DESCRIPTIONS.memex_organize,
    parameters: {},
    output: outputSchema(),
    async execute(_args, exec) {
      const current = currentFor(exec, resolver)
      const result = requireSuccess(await runner(['organize'], { home: current.home, signal: exec.signal }), 'organize', current.scope)
      return { json: JSON.stringify({ ...(kernelVersionWarning ? { kernelVersionWarning } : {}), current: route(current), content: result.stdout, warning: result.stderr.trim() ? 'memex emitted a warning' : undefined }, null, 2) }
    },
  })))

  return () => { for (const dispose of disposers.reverse()) dispose() }
}
