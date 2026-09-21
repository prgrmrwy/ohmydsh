/**
 * Runtime-level replay against the tracked fixed-runtime Inbox artifact.
 *
 * This test does not instantiate an Agent, Session, provider, model, network, or
 * production home. It uses the real patched Inbox with an in-memory append sink
 * and wires its claimed notifications into the production turn observer.
 * Generated compat artifacts are optional in a source-only checkout; when they
 * are absent this suite is explicitly skipped rather than substituting the
 * workspace's registry dependency or an old launcher build.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { createLocusTurnObserver, type LocusInboxClaim, type LocusTurnEnd } from '../src/host/locus/turn-observer.js'
import { LOCUS_FINISH_HISTORY } from './fixtures/locus-finish-history.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const compatAgentRoot = join(packageRoot, 'compat', 'subagent', 'agent-artifacts', 'agent')
const compatAgentEntry = join(compatAgentRoot, 'lib', 'index.js')
const compatAgentManifest = join(compatAgentRoot, 'package.json')
const hasBuiltCompatAgent = existsSync(compatAgentEntry) && existsSync(compatAgentManifest)

const message = (id: string, sourceKind: 'user' | 'agent-message'): UserMessage => ({
  id,
  role: 'user',
  content: [{ type: 'text', text: id }],
  source: { kind: sourceKind },
} as UserMessage)

describe.skipIf(!hasBuiltCompatAgent)('fixed-runtime Inbox × locus turn observer replay', () => {
  it('isolates next-turn from pending next-step and preserves exact continuation association', async () => {
    const manifest = JSON.parse(readFileSync(compatAgentManifest, 'utf8')) as {
      name?: string
      version?: string
      dsh_compat?: { upstreamBase?: string; patchSha256?: string }
    }
    // Provenance is DERIVED from the launcher builder, never pasted: a literal
    // here silently asserts the previous DSH pin after an upgrade, which is
    // exactly how this test started failing against a correct runtime.
    const launcherSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'compat', 'subagent', 'build-launcher.cjs'),
      'utf8',
    )
    const launcherConstant = (name: string): string => {
      const found = new RegExp(`const ${name} = '([^']+)'`).exec(launcherSource)?.[1]
      if (found === undefined) throw new Error(`build-launcher.cjs no longer defines ${name}`)
      return found
    }
    expect(manifest).toMatchObject({
      name: '@deepseek-ai/dsh-agent',
      version: `${launcherConstant('version')}-locus-isolated-claim.1`,
      dsh_compat: {
        upstreamBase: launcherConstant('reviewedCommit'),
        patchSha256: launcherConstant('subagentPatchSha256'),
      },
    })
    const { Inbox } = await import(/* @vite-ignore */ pathToFileURL(compatAgentEntry).href) as {
      Inbox: new (session: unknown, notifications: unknown) => {
        append(target: 'next-step' | 'next-turn', value: UserMessage): void
        claim(target: 'next-step' | 'next-turn', turn: number, options?: { isolateQueuedTurn?: boolean }): UserMessage[]
        readonly nextStep: readonly UserMessage[]
      }
    }
    const claimListeners: Array<(claim: LocusInboxClaim) => void> = []
    const endListeners: Array<(end: LocusTurnEnd) => void> = []
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {}
    const childSessionId = LOCUS_FINISH_HISTORY.claimBeforeBind.childSessionId
    const correlation = {
      endpoint: { chatId: 'fixture-chat', threadId: 'fixture-thread' },
      locusId: 'fixture-locus', generation: 1, childSessionId,
    }
    const observer = createLocusTurnObserver({
      onClaimed: listener => { claimListeners.push(listener); return () => {} },
      onTurnEnd: listener => { endListeners.push(listener); return () => {} },
      lookup: {
        find: ({ childSessionId: child, messageId }) => child === childSessionId && deliveries[messageId] !== undefined
          ? { ...deliveries[messageId]!, correlation }
          : undefined,
      },
    })
    const events: Array<{ type: string; data: unknown; seq: number }> = []
    const inbox = new Inbox({
      ownEvents: () => events,
      append(type: string, data: unknown) {
        const event = { type, data, seq: events.length }
        events.push(event)
        return event
      },
    }, {
      inserted() {}, discarded() {},
      claimed(value: UserMessage, turn: number) {
        const sourceKind = value.source?.kind
        for (const listener of claimListeners) listener({
          childSessionId,
          messageId: String(value.id),
          turn,
          ...(sourceKind === undefined ? {} : { sourceKind }),
        })
      },
    })

    const raced = LOCUS_FINISH_HISTORY.claimBeforeBind
    inbox.append('next-turn', message(raced.messageId, 'user'))
    expect(inbox.claim('next-turn', raced.turn, { isolateQueuedTurn: true }).map(value => value.id)).toEqual([raced.messageId])
    expect(observer.inspectCurrentCapabilityForChild?.(childSessionId)).toEqual({ ok: false, reason: 'claim-unbound' })
    deliveries[raced.messageId] = { deliveryId: raced.deliveryId, executionId: raced.executionId }
    observer.deliveryAvailable?.({ childSessionId, messageId: raced.messageId })
    expect(observer.currentCapabilityForChild?.(childSessionId)).toMatchObject({ deliveryId: raced.deliveryId, source: 'delivery' })

    for (const listener of endListeners) listener({ childSessionId, turn: raced.turn, outcome: 'completed' })
    expect(observer.inspectCurrentCapabilityForChild?.(childSessionId)).toEqual({ ok: false, reason: 'association-unproven' })

    const batch = LOCUS_FINISH_HISTORY.isolatedBatch
    inbox.append('next-step', message(batch.pendingNextStepId, 'user'))
    inbox.append('next-turn', message(batch.queuedNextTurnId, 'agent-message'))
    const claimed = inbox.claim('next-turn', batch.turn, { isolateQueuedTurn: true })
    expect(claimed.map(value => value.id)).toEqual([batch.queuedNextTurnId])
    expect(inbox.nextStep.map(value => value.id)).toEqual([batch.pendingNextStepId])
    expect(observer.currentCapabilityForChild?.(childSessionId)).toMatchObject({
      deliveryId: raced.deliveryId,
      executionId: raced.executionId,
      turnId: `${childSessionId}#${batch.turn}`,
      source: 'agent-message',
    })
    observer.dispose()
  })
})
