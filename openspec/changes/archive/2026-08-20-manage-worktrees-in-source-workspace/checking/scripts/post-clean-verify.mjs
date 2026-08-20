import { createHash, randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawnSync } from 'node:child_process'

const checkingDir = new URL('../', import.meta.url)
const cleanup = JSON.parse(await readFile(new URL('baselines/loop3-T5-pre-restart.json', checkingDir), 'utf8'))
const baseUrl = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const assertions = []
const assert = (condition, message, details = undefined) => {
  assertions.push({ ok: Boolean(condition), message, ...(details === undefined ? {} : { details }) })
  if (!condition) throw new Error(message)
}
const sha256 = value => createHash('sha256').update(value).digest('hex')
const exists = async path => { try { await access(path, constants.F_OK); return true } catch { return false } }
const git = args => spawnSync('git', ['-C', cleanup.repoRoot, ...args], { encoding: 'utf8' })

async function rpc(method, payload) {
  const rpcId = randomUUID()
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  const body = await response.json()
  assert(response.ok && body?.rpcId === rpcId && body?.result?.ok === true, `${method} failed`, body)
  return body.result.value
}
async function route(route, payload) {
  const response = await fetch(`${baseUrl}/worktree-session/api/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
  const body = await response.json()
  assert(response.ok && body?.ok === true, `worktree-session ${route} failed`, body)
  return body.data
}

try {
  assert(!await exists(cleanup.worktreePath), 'cleaned worktree path still exists')
  const branch = git(['show-ref', '--verify', '--quiet', `refs/heads/${cleanup.taskBranch}`])
  assert(branch.status === 1, 'cleaned local task branch still exists', { status: branch.status, stderr: branch.stderr })
  const rootStatus = git(['status', '--porcelain'])
  assert(rootStatus.status === 0 && rootStatus.stdout === '', 'source checkout is dirty after cleanup', rootStatus.stdout)

  const operationFile = `${cleanup.repoRoot}/.git/ws/operations/${cleanup.operationId}.json`
  const operation = JSON.parse(await readFile(operationFile, 'utf8'))
  assert(operation.schemaVersion === 2, 'cleaned operation schema changed unexpectedly')
  assert(operation.operationId === cleanup.operationId, 'cleaned operation identity changed')
  assert(operation.worktreePath === cleanup.worktreePath && operation.taskBranch === cleanup.taskBranch, 'cleaned tombstone lost resource identity')
  assert(operation.binding?.mode === 'source-session', 'cleaned tombstone lost source-session binding')
  assert(operation.binding?.sourceSessionId === cleanup.sessionId, 'cleaned tombstone changed source Session')
  assert(operation.binding?.state === 'cleaned', 'operation binding is not cleaned', operation.binding)

  const workspaceList = await rpc('workspace.list', {})
  const workspace = workspaceList.items.find(item => item.workspaceId === cleanup.workspaceId)
  assert(workspace !== undefined, 'source Workspace disappeared after cleanup')
  assert(workspace.sessionIds.includes(cleanup.sessionId), 'historical Session left the source Workspace', workspace)
  assert(workspaceList.archivedSessionIds.includes(cleanup.sessionId), 'historical Session lost archived state')

  const sessionBytes = await readFile(cleanup.sessionLogFile)
  assert(sha256(sessionBytes) === cleanup.sessionLogHash, 'cleanup rewrote archived Session history')
  const status = await route('session-status', { sessionId: cleanup.sessionId, repoPath: cleanup.repoRoot })
  assert(status.bound === true && status.cleaned === true && status.lifecycle === 'cleaned', 'Session status is not cleaned', status)

  console.log(JSON.stringify({ ok: true, assertions, operation, workspace, status }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, assertions, error: String(error) }, null, 2))
  process.exitCode = 1
}
