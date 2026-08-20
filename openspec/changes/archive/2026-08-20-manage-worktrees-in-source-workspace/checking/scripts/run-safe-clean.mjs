import { readFile } from 'node:fs/promises'

const checkingDir = new URL('../', import.meta.url)
const cleanup = JSON.parse(await readFile(new URL('baselines/loop3-T5-pre-restart.json', checkingDir), 'utf8'))
const baseUrl = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'

async function clean(dryRun) {
  const response = await fetch(`${baseUrl}/worktree-session/api/clean`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: cleanup.sessionId, repoPath: cleanup.repoRoot, dryRun }),
  })
  const body = await response.json()
  return { status: response.status, body }
}

const dryRun = await clean(true)
if (dryRun.status !== 200 || dryRun.body?.ok !== true) {
  console.error(JSON.stringify({ ok: false, stage: 'dry-run', dryRun }, null, 2))
  process.exit(1)
}

const apply = await clean(false)
if (apply.status !== 200 || apply.body?.ok !== true) {
  console.error(JSON.stringify({ ok: false, stage: 'apply', dryRun, apply }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, dryRun, apply }, null, 2))
