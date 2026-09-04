import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only side-effect import: augments `Context` with `userQuestions`.
import type {} from '@deepseek-ai/dsh-user-questions'
import type { MaintenanceTarget } from './maintenance.js'
import { wsCleanRepository, wsPromote, wsStatus } from './maintenance.js'
import { activeBoundSessionIds } from './policy.js'

/**
 * Whether a supplied path is a real explicit target.
 *
 * Older model/tool clients sometimes materialize an omitted optional string as
 * `""`. That wire artefact counts as absent, so a bound call still resolves by
 * Session identity and no authorization question is ever raised for it.
 */
export function hasExplicitPath(path: string | undefined): path is string {
  return path !== undefined && path !== ''
}

/** Minimal execution view the authorization seam reads. */
interface ExplicitPathExecution {
  readonly agent?: unknown
  readonly callId?: unknown
  readonly signal?: AbortSignal
}

/**
 * The user-questions seam this module depends on.
 *
 * Deliberately NOT `ctx.approval`: that seam governs sandbox escalation, and a
 * deployment running `danger-full-access` sets its policy to `never`, which
 * auto-rejects every request — the questions here would become unanswerable in
 * exactly the setup that needs them most. `ctx.userQuestions` is the
 * ask-a-human capability and carries no permission-policy coupling, so a
 * full-access deployment still gets a real prompt.
 *
 * Structurally typed on purpose: the tool needs only `ask`. A deployment with
 * no provider composed reads `undefined` and fails closed.
 */
interface UserQuestionsSeam {
  ask(request: never): Promise<{ answers: readonly { id: string; selected: readonly string[]; custom?: string }[] }>
}

/** The affirmative option label; anything else (or nothing) declines. */
const CONFIRM_LABEL = 'Yes, proceed'
/** The explicit declining option, so refusing never requires free text. */
const DECLINE_LABEL = 'No, stop'

/**
 * Obtain live one-shot user authorization for an Agent-supplied explicit path.
 *
 * This is the ONLY way an Agent may name a target: the path is untrusted until
 * the user approves this exact call, and the grant covers nothing else. The
 * seam is deliberately caller-agnostic — it knows nothing about which runtime
 * produced the path, only that a human confirmed it here and now.
 *
 * Fail closed on every non-grant: a rejection, a withdrawal, a missing
 * answerer, an absent approval service, and a throwing service (for example an
 * ask outside an open turn) all refuse. Falling back to the caller's own cwd
 * would silently turn "nobody could be asked" into "guess the target", so it
 * is never done.
 * @param ctx - Carrier of the approval service; `undefined` fails closed.
 * @param exec - The tool execution carrying agent, call identity and signal.
 * @param request - The exact action and path being authorized.
 * @returns the authorized path, unchanged.
 * @throws when authorization is not granted for this call.
 */
/**
 * Put one yes/no question to the user and report whether they agreed.
 *
 * The seam is consumed opportunistically through cordis' reflection-safe
 * `ctx.get`, so an absent provider reads `undefined` instead of raising an
 * inject error. Every non-agreement fails closed: no provider, a throwing ask
 * (an aborted step, or a caller that is not the live runtime root), a declined
 * option, and a free-text reply that does not select the affirmative option.
 * Silence is never read as consent.
 * @param ctx - Carrier of the user-questions service.
 * @param exec - The execution carrying the live agent and abort signal.
 * @param question - The one-line decision put to the user.
 * @param detail - The exact facts the user needs to judge it.
 * @returns whether the user explicitly agreed to this one action.
 */
async function askUser(
  ctx: { get?: (name: string) => unknown },
  exec: ExplicitPathExecution,
  question: string,
  detail: string,
): Promise<boolean> {
  const questions = ctx.get?.('userQuestions') as UserQuestionsSeam | undefined
  if (questions === undefined) return false
  try {
    // The Host owns the agent and signal; this seam forwards them verbatim.
    const answer = await questions.ask({
      questions: [{
        id: 'ws-confirm',
        question,
        detail,
        header: 'Worktree Session',
        options: [
          { label: CONFIRM_LABEL, description: 'Proceed with exactly this action.' },
          { label: DECLINE_LABEL, description: 'Cancel; nothing is changed.' },
        ],
      }],
      ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
      ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
    } as never)
    return answer.answers.some(item => item.id === 'ws-confirm' && item.selected.includes(CONFIRM_LABEL))
  } catch {
    return false
  }
}

export async function authorizeExplicitPath(
  ctx: { get?: (name: string) => unknown },
  exec: ExplicitPathExecution,
  request: { action: string; path: string },
): Promise<string> {
  const refusal = new Error(
    `ws explicit path ${request.path} was not authorized by the user for this ${request.action} call; ` +
    'ask the user to approve the request, or use the path-oriented dsh-ws CLI',
  )
  // The question names the exact action and path so the user judges the real
  // effect, and states that the grant is single-use.
  const granted = await askUser(ctx, exec,
    `Run ws ${request.action} against ${request.path}?`,
    `That path is outside the calling Session's own binding. ` +
    'Agreeing authorizes this call once only; every later explicit-path call asks again. ' +
    'All Worktree Session safety gates still apply afterwards.')
  if (!granted) throw refusal
  return request.path
}

/**
 * Resolve the `status`/`promote` target.
 *
 * An explicit path reaches here only after {@link authorizeExplicitPath} has
 * proven user authorization for this call, so it carries the same trust as the
 * operator CLI's explicit path and uses the identical single-operation
 * semantics. Without one, resolution stays bound to the calling Session.
 */
export function targetFor(
  args: object & { path?: string },
  exec: { agent?: { session: { id: unknown; header: { cwd?: string } } } },
  authorizedPath?: string,
): MaintenanceTarget | string {
  const agent = exec.agent
  if (hasExplicitPath(args.path)) {
    // A non-Agent (operator/CLI/Host) caller keeps its long-standing direct
    // path entry; an Agent must arrive with proof the user authorized it.
    if (agent === undefined) return args.path
    if (authorizedPath === args.path) return args.path
    throw new Error('ws explicit path requires one-shot user authorization for an Agent-bound call; use the Session binding or the path-oriented dsh-ws CLI')
  }
  const repoPath = agent?.session.header.cwd
  if (agent === undefined || repoPath === undefined) throw new Error('ws requires a calling Session binding or an explicit operator recovery path')
  return { sessionId: String(agent.session.id), repoPath }
}

/**
 * Resolve the repository a `clean` call may scan.
 *
 * Cleanup is repository-oriented rather than binding-oriented: it runs against
 * a repository main checkout, never from a Session still bound to a worktree
 * (which cannot clean itself and must not sweep its peers). By default only
 * the calling Session's own cwd is used; a user-authorized explicit path may
 * name a different main checkout for this one call, and it is the sole way a
 * model can do so. The repository-level scan then applies exactly the same
 * main-checkout proof and per-candidate safety gates either way.
 */
export function cleanTargetFor(
  exec: { agent?: { session: { id: unknown; header: { cwd?: string } } } },
  context: { boundSessionIds: readonly string[]; authorizedPath?: string },
): { repoPath: string } {
  // An authorized path replaces only the SOURCE of the repository path. It is
  // not a safety exemption: wsCleanRepository still proves the path is a
  // repository main checkout and still runs every per-candidate gate.
  if (context.authorizedPath !== undefined) return { repoPath: context.authorizedPath }
  const agent = exec.agent
  const repoPath = agent?.session.header.cwd
  if (agent === undefined || repoPath === undefined) throw new Error('ws clean requires a calling Session whose working directory is the repository main checkout')
  if (context.boundSessionIds.includes(String(agent.session.id))) {
    throw new Error('ws clean is unavailable to a bound Worktree Session; run it from an ordinary main-checkout Session in the same repository')
  }
  return { repoPath }
}

/**
 * Agent-visible arguments.
 *
 * `path` is declared so the authorization channel is DISCOVERABLE from the
 * schema. Leaving it undeclared would make the capability reachable only by a
 * model that guesses an undocumented argument, since the parameter root is
 * open. Declaring it does not widen authority: an Agent-supplied path is
 * untrusted until the user approves that exact call.
 */
export const WS_TOOL_PARAMETERS = {
  action: { type: 'string', required: true, enum: ['status', 'promote', 'clean'] as const, description: 'Maintenance action. status/promote target the exact calling Session binding; clean scans the calling repository.' },
  dry_run: { type: 'boolean', description: 'For clean only, preview the safety-proven actions without removing resources.' },
  path: { type: 'string', description: "Optional absolute path targeting a repository main checkout (clean) or a worktree (status/promote) other than the calling Session's own. Every use requires one-shot user authorization, granted per call and never reused, and all safety gates still apply. Omit it whenever the calling Session already sits at the intended target." },
} as const

/** Register the Session-oriented maintenance tool. */
export function registerWsTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'ws',
    description: "Inspect or promote the exact current Worktree Session binding. Clean runs from an ordinary main-checkout Session and cleans this repository's archived Worktree Sessions, applying the active/dirty/merge safety gates to each candidate. To target a repository or worktree other than the calling Session's own, pass an absolute path: it is refused unless the user grants one-shot authorization for that exact call, and all safety gates still apply. Unattended path-oriented operator recovery remains available through dsh-ws or the Skill shell wrapper.",
    parameters: WS_TOOL_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args, exec) {
      // An Agent-supplied path is untrusted until the user authorizes THIS
      // call. Asking first means a refusal costs nothing: no operation is
      // scanned, resolved or deleted before the answer arrives.
      const authorizedPath = hasExplicitPath(args.path) && exec.agent !== undefined
        ? await authorizeExplicitPath(ctx, exec, { action: args.action, path: args.path })
        : undefined

      // Clean is repository-oriented and takes its trusted inputs (archive
      // membership, live Session paths, protected bindings) from the Host.
      if (args.action === 'clean') {
        const bound = activeBoundSessionIds(ctx)
        const { repoPath } = cleanTargetFor(exec, {
          boundSessionIds: bound,
          ...(authorizedPath !== undefined ? { authorizedPath } : {}),
        })
        const result = await wsCleanRepository(repoPath, {
          dryRun: args.dry_run ?? false,
          archivedSessionIds: ctx.workspaceRegistry.archivedSessionIds.map(String),
          activePaths: ctx.sessions.list().flatMap(session => session.header.cwd === undefined ? [] : [session.header.cwd]),
          activeBoundSessionIds: bound,
          // A finished-but-unarchived Worktree Session is offered as one
          // action: the user confirms, the Host archives, then the existing
          // clean runs. Only reachable from this Agent-facing tool — the
          // operator CLI and HTTP routes inject neither hook and keep the
          // historical refusal, having no trustworthy way to ask.
          confirmArchive: offer => askUser(ctx, exec,
            `Finish and clean up the Worktree Session on branch ${offer.taskBranch}?`,
            `Source Session: ${offer.sourceSessionId}\n` +
            `Worktree: ${offer.worktreePath}\n` +
            'That branch is proven merged and the worktree has no uncommitted changes. ' +
            'Agreeing archives that Session and then removes the worktree and the local task branch. ' +
            'Removal is irreversible; the archived Session itself stays recoverable by unarchiving it.'),
          archiveSession: async sourceSessionId => {
            await ctx.workspaceRegistry.archiveSession(sourceSessionId as never)
          },
        })
        return { json: JSON.stringify(result, null, 2) }
      }
      const target = targetFor(args, exec, authorizedPath)
      const result = args.action === 'status' ? await wsStatus(target) : await wsPromote(target)
      return { json: JSON.stringify(result, null, 2) }
    },
  }))
}
