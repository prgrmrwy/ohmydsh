/**
 * QA children must be left entirely alone by Pet's scoped composition.
 *
 * A `qa-chat` Task stores its fork child's session id in the SAME
 * `executorSessionId` field an ordinary Task uses for the root executor Pet
 * created. That one shared field is the whole defect: Pet's `agent/created`
 * observer looks a Task up by executor session id, so when DSH published a QA
 * child it matched and Pet composed the child as if it were a Pet executor.
 *
 * Two things then went wrong, and the visible symptom was the milder one:
 *
 * 1. `pet_context` became visible on the child, so the model called it — the
 *    tool's own description tells it to, "at the start of every Invocation" —
 *    and got `NO_CURRENT_INVOCATION`: `Pet Task ... has no running or waiting
 *    Invocation right now.` QA delivery queues a turn straight into the
 *    child's inbox and never creates an Invocation record, so that lookup can
 *    NEVER succeed for this form, no matter how healthy the session is.
 * 2. Silently worse: a QA Task usually has no `residentWorkspaceId`, so the
 *    installer's `includeAllowlist` argument was true and Pet's allowlist
 *    Skill provider was installed on the child — narrowing the inherited
 *    Skill catalog the group exists to reuse.
 *
 * These cases pin the source-kind decision itself, and the two call sites that
 * must agree on it, rather than re-testing tool plumbing that `tool-scope`
 * already covers.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isForkChildTaskForm, type PetSourceKind } from '../src/wire.js'
import { resolveTrustedContext } from '../src/host/capture.js'
import { PetError } from '../src/host/errors.js'
import { openPetHarness, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

/** Source kinds whose Task owns a root executor Pet itself created. */
const ROOT_EXECUTOR_KINDS: PetSourceKind[] = ['session', 'workspace', 'none', 'chat']

describe('the fork-child Task form is recognised', () => {
  it('classifies a qa-chat Task as a fork child', () => {
    expect(isForkChildTaskForm('qa-chat')).toBe(true)
  })

  it('classifies every root-executor Task form as composable by Pet', () => {
    // Guards the inverse direction: a future source kind must not silently
    // inherit the QA exemption and lose `pet_context`.
    for (const kind of ROOT_EXECUTOR_KINDS) {
      expect(isForkChildTaskForm(kind)).toBe(false)
    }
  })
})

describe('a QA child could never answer pet_context', () => {
  it('fails with NO_CURRENT_INVOCATION, which is why the tool must not be offered', async () => {
    harness = await openPetHarness()
    // Exactly what the QA action persists: the child's session id in the
    // executor field, `idle`, and no Invocation — there is no executor to
    // create, so the Task is committed straight to `idle`.
    await harness.repository.createTask(
      testTask({
        id: 'task-qa',
        scopeKey: 'qa:src-1',
        sourceKind: 'qa-chat',
        sourceId: 'oc-chat-1',
        executorSessionId: 'session-qa-child',
      }),
    )

    // This is the exact failure the user saw. It is not a broken session and
    // not a race: the QA form has no Invocation to resolve, ever.
    const attempt = (): unknown =>
      resolveTrustedContext(harness!.repository, 'session-qa-child')
    expect(attempt).toThrow(PetError)
    expect(attempt).toThrow(/has no running or waiting Invocation/)
    try {
      attempt()
    } catch (error) {
      expect((error as PetError).code).toBe('NO_CURRENT_INVOCATION')
    }
  })
})

describe('Pet does not compose agents it does not own', () => {
  it('skips the fork-child form before installing any scoped surface', async () => {
    const source = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')
    const observer = source.slice(
      source.indexOf('const composeForeignExecutor'),
      source.indexOf('ctx.effect', source.indexOf('const composeForeignExecutor')),
    )

    expect(observer).toContain('isForkChildTaskForm(task.sourceKind)')
    // Order matters as much as presence: the guard is worthless if it runs
    // after the installer. Assert the return precedes the install call.
    expect(observer.indexOf('isForkChildTaskForm')).toBeLessThan(
      observer.indexOf('installPetScope(view.ctx'),
    )
  })
})
