#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { homedir } from 'node:os'
import path from 'node:path'
// Session logs are decoded through the skill's own module because sync copies
// each skill directory wholesale into $DSH_HOME; a deployed recorder cannot
// import from scripts/. One shared decoder keeps this probe and the recorder
// reading logs identically.
import {
  SESSION_LOG_REASONS,
  findSessionLog,
  parseSessionEvents,
  readSessionLogFile,
} from '../skills/jev-workflow-router/session-log.mjs'

const repo = process.env.DSH_REPO_ROOT ? path.resolve(process.env.DSH_REPO_ROOT) : path.resolve(new URL('..', import.meta.url).pathname)
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

/**
 * Inspect the current session's event log.
 *
 * Failure carries a specific, actionable reason instead of one opaque boolean.
 * A missing `zstd` binary is no longer a way to fail: decoding uses Node's
 * built-in zstd and walks every frame, so a multi-frame log can never be
 * mistaken for a short or empty one.
 */
function inspectSession() {
  const located = findSessionLog({ dshHome, sessionId })
  if (located.file === undefined) {
    return { available: false, reason: located.reason ?? SESSION_LOG_REASONS.FILE_MISSING }
  }
  const decoded = readSessionLogFile(located.file)
  if (!decoded.ok) {
    return { available: false, reason: decoded.reason, file: located.name }
  }
  let requestHeaders = 0
  let lastToolNames = []
  let latestCatalog = ''
  for (const event of parseSessionEvents(decoded.text)) {
    if (event.type === 'request/header') {
      requestHeaders += 1
      lastToolNames = (event.data?.header?.tools ?? []).map(tool => typeof tool === 'string' ? tool : tool?.name).filter(Boolean)
    }
    if (event.type === 'user/message' && event.data?.source?.kind === 'skill-catalog') {
      const content = event.data.content
      latestCatalog = Array.isArray(content) ? content.map(item => item.text ?? '').join('') : String(content ?? '')
    }
  }
  if (requestHeaders === 0) {
    return { available: false, reason: SESSION_LOG_REASONS.NO_REQUEST_HEADER, file: located.name, frames: decoded.frames }
  }
  return {
    available: true,
    file: located.name,
    frames: decoded.frames,
    requestHeaders,
    toolCount: lastToolNames.length,
    jevTools: lastToolNames.filter(name => name.startsWith('mcp__jev__')).sort(),
    routerSkill: latestCatalog.includes('jev-workflow-router'),
    specSuperflowSkills: superflowSkills.filter(name => latestCatalog.includes(name)),
  }
}

/**
 * Expected exact versions come from the manifest's thirdPartyResources, so a
 * provider bump (e.g. a DSH runtime upgrade moving dsh-mcp-client) cannot leave
 * this probe asserting a stale literal.
 */
function expectedVersions() {
  let manifest
  try {
    manifest = yaml.load(readFileSync(path.join(repo, 'dsh.yaml'), 'utf8')) ?? {}
  } catch {
    // A missing or unreadable manifest degrades to "unknown expectation" rather
    // than crashing the probe: the session half is still useful on its own.
    manifest = {}
  }
  const resources = new Map((manifest.thirdPartyResources ?? []).map(resource => [resource.id, resource]))
  const jev = resources.get('jev')
  const superflow = resources.get('spec-superflow')
  return {
    credentialEnv: typeof jev?.credentialEnv === 'string' ? jev.credentialEnv : undefined,
    jev: jev?.version,
    bridge: jev?.bridge?.version,
    specSuperflow: superflow?.version,
    skillProvider: superflow?.provider?.version,
  }
}

const localEnvVariables = declaredVariables(path.join(repo, '.env.local'))
const expected = expectedVersions()
const profilePackage = path.join(dshHome, 'profiles', profile, 'package.json')
const patch = path.join(dshHome, 'profiles', profile, 'cordis.patch.yml')
const packageJson = existsSync(profilePackage) ? JSON.parse(readFileSync(profilePackage, 'utf8')) : {}
const dependencies = packageJson.dependencies ?? {}
const patchText = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
const session = inspectSession()

const report = {
  reportVersion: 1,
  credential: {
    variable: expected.credentialEnv ?? null,
    currentProcess: expected.credentialEnv ? Boolean(process.env[expected.credentialEnv]) : false,
    privateEnvDeclaration: expected.credentialEnv ? localEnvVariables.includes(expected.credentialEnv) : false,
    valueInspected: false,
  },
  profile: {
    profile,
    exactPackages: {
      jev: expected.jev !== undefined && dependencies['@jkudish/jev-mcp'] === expected.jev,
      bridge: expected.bridge !== undefined && dependencies['@deepseek-ai/dsh-mcp-client'] === expected.bridge,
      specSuperflow: expected.specSuperflow !== undefined && dependencies['spec-superflow'] === expected.specSuperflow,
      skillProvider: expected.skillProvider !== undefined && dependencies['@deepseek-ai/dsh-skill-filesystem'] === expected.skillProvider,
    },
    insertionRows: {
      jev: /- insert:\n\s+- id: "third-party-jev-bridge"/u.test(patchText),
      specSuperflow: /- insert:\n\s+- id: "third-party-spec-superflow-skills"/u.test(patchText),
    },
  },
  currentSession: session,
  liveProbeReady: session.jevTools?.includes('mcp__jev__jev_classify')
    && session.jevTools?.includes('mcp__jev__jev_decide'),
}

process.stdout.write(`${JSON.stringify(report)}\n`)
