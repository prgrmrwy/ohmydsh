#!/usr/bin/env node
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { prepareWorkspaceEmbed, WORKSPACE_EMBED_DIR as GENERATED } from './prepare-workspace-embed.mjs'

const PACKAGE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(PACKAGE, '../..')
const LIB = path.join(PACKAGE, 'lib')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: PACKAGE, shell: false, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code ?? signal}`))
    })
  })
}

async function main() {
  await rm(LIB, { recursive: true, force: true })
  const embed = await prepareWorkspaceEmbed()
  await run(path.join(REPO, 'node_modules/.bin/tsc'), ['-p', path.join(PACKAGE, 'tsconfig.json')])
  await run(process.execPath, [path.join(PACKAGE, 'build-client.mjs')])
  await mkdir(path.join(LIB, 'workspace-embed-meta'), { recursive: true })
  const provenance = JSON.parse(await readFile(embed.provenancePath, 'utf8'))
  await cp(embed.provenancePath, path.join(LIB, 'workspace-embed-meta/provenance.json'))
  process.stdout.write(`[dsh-federation] workspace embed ${embed.reused ? 'reused' : 'rebuilt'} ${provenance.patch.sha256}\n`)
}

main().catch(error => {
  console.error(`[dsh-federation] build failed before deployment: ${error.message}`)
  process.exitCode = 1
})
