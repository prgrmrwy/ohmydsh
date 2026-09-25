#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repo = path.resolve(new URL('..', import.meta.url).pathname)
const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
const profile = process.env.DSH_PROFILE || 'web'
const sessionId = process.env.DSH_SESSION_ID || ''
const superflowSkills = ['bug-investigator', 'build-executor', 'code-reviewer', 'contract-builder', 'need-explorer', 'release-archivist', 'spec-merger', 'spec-writer', 'workflow-start']

function declaredVariables(file) {
  if (!existsSync(file)) return []
  const names = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u)
    if (match) names.push(match[1])
  }
  return [...new Set(names)].sort()
}

function findSessionFile() {
  if (!sessionId) return undefined
  const root = path.join(dshHome, 'sessions')
  if (!existsSync(root)) return undefined
  for (const workspace of readdirSync(root)) {
    const directory = path.join(root, workspace, sessionId)
    const file = path.join(directory, 'session.v3.jsonl.zstd')
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  return undefined
}

function inspectSession(file) {
  if (!file) return { available: false }
  const decoder = spawnSync('zstd', ['-dc', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (decoder.status !== 0) return { available: false, decodeFailed: true }
  let requestHeaders = 0
  let lastToolNames = []
  let latestCatalog = ''
  for (const line of decoder.stdout.split('\n')) {
    if (!line) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.type === 'request/header') {
      requestHeaders += 1
      lastToolNames = (event.data?.header?.tools ?? []).map(tool => typeof tool === 'string' ? tool : tool?.name).filter(Boolean)
    }
    if (event.type === 'user/message' && event.data?.source?.kind === 'skill-catalog') {
      const content = event.data.content
      latestCatalog = Array.isArray(content) ? content.map(item => item.text ?? '').join('') : String(content ?? '')
    }
  }
  return {
    available: true,
    requestHeaders,
    toolCount: lastToolNames.length,
    jevTools: lastToolNames.filter(name => name.startsWith('mcp__jev__')).sort(),
    routerSkill: latestCatalog.includes('jev-workflow-router'),
    specSuperflowSkills: superflowSkills.filter(name => latestCatalog.includes(name)),
  }
}

const localEnvVariables = declaredVariables(path.join(repo, '.env.local'))
const profilePackage = path.join(dshHome, 'profiles', profile, 'package.json')
const patch = path.join(dshHome, 'profiles', profile, 'cordis.patch.yml')
const packageJson = existsSync(profilePackage) ? JSON.parse(readFileSync(profilePackage, 'utf8')) : {}
const dependencies = packageJson.dependencies ?? {}
const patchText = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
const session = inspectSession(findSessionFile())

const report = {
  reportVersion: 1,
  credential: {
    currentProcess: Boolean(process.env.TYPESAFE_API_KEY),
    privateEnvDeclaration: localEnvVariables.includes('TYPESAFE_API_KEY'),
    valueInspected: false,
  },
  profile: {
    profile,
    exactPackages: {
      jev: dependencies['@jkudish/jev-mcp'] === '0.6.0',
      bridge: dependencies['@deepseek-ai/dsh-mcp-client'] === '0.1.5-rc.2',
      specSuperflow: dependencies['spec-superflow'] === '2.0.1',
      skillProvider: dependencies['@deepseek-ai/dsh-skill-filesystem'] === '0.1.5-rc.2',
    },
    insertionRows: {
      jev: /- insert:\n\s+- id: "third-party-jev-bridge"/u.test(patchText),
      specSuperflow: /- insert:\n\s+- id: "third-party-spec-superflow-skills"/u.test(patchText),
    },
  },
  currentSession: session,
  liveProbeReady: Boolean(process.env.TYPESAFE_API_KEY)
    && session.jevTools?.includes('mcp__jev__jev_classify')
    && session.jevTools?.includes('mcp__jev__jev_decide'),
}

process.stdout.write(`${JSON.stringify(report)}\n`)
