import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { StageDependencies } from './stage-target.js'
import { ADAPTER_BLOCK_END, ADAPTER_BLOCK_START, WORKFLOWS } from './upstream-compat.js'

function run(command: string, args: string[], options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ status: number | null; output: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
    child.on('close', status => { clearTimeout(timer); resolve({ status, output }) })
    child.on('error', () => { clearTimeout(timer); resolve({ status: null, output }) })
  })
}

export function officialStageDependencies(_root: string): StageDependencies {
  return {
    async fetchMetadata(target) {
      const response = await fetch(`https://registry.npmjs.org/@fission-ai%2Fopenspec/${encodeURIComponent(target)}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error('registry-metadata-unavailable')
      const meta = await response.json() as { dist?: { integrity?: unknown; tarball?: unknown } }
      return { integrity: meta.dist?.integrity, tarball: meta.dist?.tarball }
    },
    async install(stageDir) {
      const result = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund',], { cwd: stageDir, timeoutMs: 120_000 })
      if (result.status !== 0) throw new Error('stage-install-failed')
    },
    async smoke(stageRoot, target) {
      const manifest = JSON.parse(await readFile(join(stageRoot, 'package.json'), 'utf8'))
      const result = await run(process.execPath, [join(stageRoot, manifest.bin.openspec), '--version'], { cwd: stageRoot, timeoutMs: 10_000, env: { PATH: process.env.PATH, OPENSPEC_NO_UPDATE_CHECK: '1', OPENSPEC_TELEMETRY: '0' } })
      return result.status === 0 && result.output.trim() === target
    },
    async parity(stageRoot, target) {
      const generation: any = await import(pathToFileURL(join(stageRoot, 'dist/core/shared/skill-generation.js')).href)
      const manifest = JSON.parse(await readFile(join(stageRoot, 'package.json'), 'utf8'))
      if (manifest.name !== '@fission-ai/openspec' || manifest.version !== target || typeof generation.getSkillTemplates !== 'function' || typeof generation.generateSkillContent !== 'function') return false
      // Unfiltered discovery catches newly added upstream ids instead of silently filtering them away.
      const entries = generation.getSkillTemplates()
      if (!Array.isArray(entries) || entries.length !== WORKFLOWS.length || new Set(entries.map((entry: any) => entry.workflowId)).size !== WORKFLOWS.length) return false
      const customNames = new Set(['openspec-init', 'openspec-upgrade'])
      for (const entry of entries) {
        if (!WORKFLOWS.includes(entry.workflowId) || typeof entry.dirName !== 'string' || !entry.template || customNames.has(entry.dirName) || customNames.has(`opsx-${entry.workflowId}`)) return false
        const body: string = generation.generateSkillContent(entry.template, target, (text: string) => text.replace(/\/opsx:([a-z][a-z0-9-]*)/g, '/opsx-$1'))
        if (!body.trim() || body.includes(ADAPTER_BLOCK_START) || body.includes(ADAPTER_BLOCK_END) || body.includes('</skill_instructions>') || body.includes('</skill_content>')) return false
      }
      return true
    },
  }
}
