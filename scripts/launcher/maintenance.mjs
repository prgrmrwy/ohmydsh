import fs from 'node:fs'
import path from 'node:path'

export function appendEvent(home, text, filename = 'dsh-startup.log') {
  fs.mkdirSync(home, { recursive: true })
  fs.appendFileSync(path.join(home, filename), `[${new Date().toISOString()}] ${text}\n`)
}

export async function ensurePrerequisites(context) {
  const { env, home, runScript, log, warn } = context
  if (/^(1|true|yes|on)$/i.test(env.DSH_SKIP_HOST_PREREQUISITES ?? '')) {
    log('本机运行前提:已按 DSH_SKIP_HOST_PREREQUISITES 跳过自愈')
    appendEvent(home, 'hostPrerequisites: skipped (DSH_SKIP_HOST_PREREQUISITES)')
    return
  }
  const result = await runScript('host-prerequisites.mjs', [], { capture: true })
  if (result.stdout) log(result.stdout.trimEnd())
  if (result.stderr) warn(result.stderr.trimEnd())
  if (result.status !== 0) {
    warn('warn: 本机运行前提未全部满足；这不影响启动，恢复网络后重跑 dsh doctor')
    appendEvent(home, `hostPrerequisites: failed (exit ${result.status})`)
  } else if (result.stdout?.includes('已安装')) appendEvent(home, 'hostPrerequisites: installed')
}

export async function autoUpdate(context) {
  const { repo, home, runScript, run, log, warn, npmEnv } = context
  const result = await runScript('check-update.mjs', [], { capture: true })
  let data
  try { data = JSON.parse(result.stdout) } catch {
    warn('warn: 版本检测不可用，按当前版本继续')
    return false
  }
  if (!data.enabled) return false
  if (data.status === 'offline') {
    log(`warn: 版本检测失败(${data.error ?? ''}),按当前版本继续`)
    appendEvent(home, `autoUpdate: offline (${data.error ?? ''})`)
    return false
  }
  if (data.status !== 'update') return false
  const status = await run('git', ['-C', repo, 'status', '--porcelain'], { env: npmEnv, capture: true })
  if (status.status !== 0) throw new Error('无法确认 git 工作区状态，拒绝自动更新')
  if (status.stdout.trim()) {
    log(`检测到新版本 ${data.latest},但仓库有未提交改动,已跳过自动更新(提交后下次启动自动升级)`)
    appendEvent(home, `autoUpdate: skip upgrade to ${data.latest} (dirty-worktree)`)
    return false
  }
  log(`检测到新版本 ${data.current} -> ${data.latest} (channel=${data.channel}),开始自动升级...`)
  const rewrite = await runScript('check-update.mjs', ['--rewrite-to', String(data.latest)], { capture: true })
  if (rewrite.status !== 0 || !rewrite.stdout.includes('wrote ')) throw new Error('自动改写 dsh.yaml 失败')
  const sync = await runScript('sync.mjs')
  const backup = path.join(repo, 'dsh.yaml.bak')
  if (sync.status !== 0) {
    if (fs.existsSync(backup)) { fs.copyFileSync(backup, path.join(repo, 'dsh.yaml')); fs.unlinkSync(backup) }
    throw new Error('升级后 sync 失败，从 dsh.yaml.bak 回滚 dsh.yaml')
  }
  const after = await run('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], { env: npmEnv, capture: true })
  const changes = after.stdout.split(/\r?\n/).filter(Boolean).filter(line => line.slice(3) !== 'dsh.yaml.bak')
  if (after.status !== 0 || changes.some(line => line.slice(3) !== 'dsh.yaml')) throw new Error('升级 sync 后工作区有额外改动，拒绝自动 commit；请手动检查')
  const add = await run('git', ['-C', repo, 'add', 'dsh.yaml'], { env: npmEnv })
  const commit = add.status === 0 ? await run('git', ['-C', repo, 'commit', '--no-verify', '-m', `chore(dsh): auto-bump ${data.current} → ${data.latest}`], { env: npmEnv, capture: true }) : add
  if (commit.status !== 0) throw new Error('自动 commit 失败；dsh.yaml 已升级并完成 build，请手动 commit 或回滚')
  if (fs.existsSync(backup)) fs.unlinkSync(backup)
  appendEvent(home, `autoUpdate: ${data.current} -> ${data.latest} (channel=${data.channel})`)
  log(`DSH 已自动升级至 ${data.latest} 并提交。`)
  return true
}
