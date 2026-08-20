import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const checkingDir = new URL('../', import.meta.url)
const legacyBaselinePath = new URL('baselines/loop4-T6-schema-v1-fixture-before-restart.json', checkingDir)
const cleanupBaselinePath = new URL('baselines/loop3-T5-pre-restart.json', checkingDir)
const legacy = JSON.parse(await readFile(legacyBaselinePath, 'utf8'))
const cleanup = JSON.parse(await readFile(cleanupBaselinePath, 'utf8'))
const expectActive = process.argv.includes('--expect-active')
const baseUrl = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const assertions = []
const assert = (condition, message, details = undefined) => {
  assertions.push({ ok: Boolean(condition), message, ...(details === undefined ? {} : { details }) })
  if (!condition) throw new Error(message)
}

async function rpc(method, payload) {
  const rpcId = randomUUID()
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  const body = await response.json()
  assert(response.ok, `${method} carrier failed`, { status: response.status })
  assert(body?.rpcId === rpcId, `${method} rpcId mismatch`)
  assert(body?.result?.ok === true, `${method} business request failed`, body?.result)
  return body.result.value
}

async function worktreeRoute(route, payload) {
  const response = await fetch(`${baseUrl}/worktree-session/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: response.status, body: await response.json() }
}

try {
  const workspaceList = await rpc('workspace.list', {})
  const workspace = workspaceList.items.find(item => item.workspaceId === legacy.workspaceId)
  assert(workspace !== undefined, 'legacy Workspace id is missing after restart')
  assert(workspace.path === legacy.path, 'legacy Workspace path changed', workspace)
  assert(workspace.title === legacy.workspaceCreate.response.result.value.workspace.title, 'legacy Workspace title changed', workspace)
  assert(workspace.sessionIds.includes(legacy.sessionId), 'legacy target Session ownership changed', workspace)

  const operationBytes = await readFile('/Users/bytedance/mydir/opensource/ohmydsh/.git/ws/operations/12077df1-7387-471c-a1ab-6f8f7c344f96.json')
  const operation = JSON.parse(operationBytes)
  assert(sha256(operationBytes) === legacy.operationHash, 'schema-v1 operation hash changed')
  assert(operation.schemaVersion === 1, 'schema-v1 operation was migrated')
  assert(operation.binding === undefined, 'schema-v1 operation acquired a source binding')
  assert(operation.handoff?.targetSessionId === legacy.sessionId, 'legacy target handoff changed', operation.handoff)

  const sessionBytes = await readFile(legacy.sessionLogFile)
  assert(sha256(sessionBytes) === legacy.sessionLogHash, 'unopened legacy Session history hash changed')

  const status = await worktreeRoute('status', { path: legacy.path })
  assert(status.status === 200 && status.body?.ok === true, 'legacy path-based status failed', status)
  assert(status.body.data?.operationId === operation.operationId, 'legacy status resolved a different operation', status.body)

  const cleanupSessionBytes = await readFile(cleanup.sessionLogFile)
  assert(sha256(cleanupSessionBytes) === cleanup.sessionLogHash, 'archived source Session history changed before cleanup')

  const dryRun = await worktreeRoute('clean', {
    sessionId: cleanup.sessionId,
    repoPath: cleanup.repoRoot,
    dryRun: true,
  })
  if (expectActive) {
    assert(dryRun.body?.ok === false && dryRun.body?.error?.code === 'CLEAN_REFUSED' && /active source Session/.test(dryRun.body?.error?.message ?? ''), 'expected active-Session cleanup refusal before restart', dryRun)
  } else {
    assert(dryRun.status === 200 && dryRun.body?.ok === true, 'T5 cleanup dry-run is not safe after restart', dryRun)
  }

  console.log(JSON.stringify({ ok: true, mode: expectActive ? 'expect-active' : 'post-restart', assertions, dryRun }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, mode: expectActive ? 'expect-active' : 'post-restart', assertions, error: String(error) }, null, 2))
  process.exitCode = 1
}
