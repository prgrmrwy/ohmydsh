#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
try {
  const { dependenciesHealthy } = await import('../scripts/bootstrap.mjs')
  if (!dependenciesHealthy(repo)) throw new Error('根依赖不完整；请在仓库执行 node scripts/bootstrap.mjs（锁定安装 npm ci），然后 npm link')
  const { runLauncher } = await import('../scripts/launcher/main.mjs')
  process.exitCode = await runLauncher(process.argv.slice(2), { repo })
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
}
