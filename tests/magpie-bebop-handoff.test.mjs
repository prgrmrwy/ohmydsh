import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

for (const pkg of ['dsh-magpie-connector', 'dsh-auto-model-routing']) {
const load = name => yaml.load(readFileSync(new URL(`../packages/${pkg}/.github/workflows/${name}`, import.meta.url), 'utf8'))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const repo = { owner: 'prgrmrwy', repo: pkg }
const HOUR = 60 * 60 * 1000
const core = { info() {}, warning() {} }

function fakeGithub({ issues = [], comments = {}, get = {} }) {
  const created = []
  const listForRepo = () => {}, listComments = () => {}
  const github = {
    paginate: async (method, params) => method === listForRepo ? issues : comments[params.issue_number] ?? [],
    rest: { issues: { listForRepo, listComments, createComment: async body => created.push(body),
      get: async ({ issue_number }) => { if (!get[issue_number]) throw new Error('Not Found'); return { data: get[issue_number] } } } },
  }
  return { github, created }
}

const handoff = load('issue-handoff.yml')
const handoffScript = handoff.jobs.handoff.steps[0].with.script
const triage = '<!-- bebop:issue-triage -->'
const issue = (number, hours, login = 'reporter', extra = {}) =>
  ({ number, created_at: new Date(Date.now() - hours * HOUR).toISOString(), user: { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' }, ...extra })
async function runHandoff(input) {
  const { github, created } = fakeGithub(input)
  await new AsyncFunction('github', 'context', 'core', handoffScript)(github, { repo }, core)
  return created
}

test(`${pkg}: handoff runs hourly from trusted inline code with only issue write access`, () => {
  assert.deepEqual(handoff.on.schedule, [{ cron: '23 * * * *' }])
  assert.deepEqual(handoff.permissions, { issues: 'write' })
  assert.equal(handoff.jobs.handoff.steps.length, 1)
  assert.match(handoff.jobs.handoff.steps[0].uses, /^actions\/github-script@[a-f0-9]{40}/)
})

test(`${pkg}: only open human issues older than 4 hours without a maintainer or agent reply are handed off once`, async () => {
  const created = await runHandoff({
    issues: [issue(1, 5), issue(2, 3), issue(3, 20, 'prgrmrwy'), issue(4, 20, 'dependabot[bot]'), issue(5, 20, 'reporter', { pull_request: {} }),
      issue(6, 20), issue(7, 20), issue(8, 20)],
    comments: { 6: [{ user: { login: 'prgrmrwy' }, body: 'on it' }], 7: [{ user: { login: 'github-actions[bot]' }, body: triage }],
      8: [{ user: { login: 'outsider' }, body: triage }] },
  })
  assert.deepEqual(created.map(c => c.issue_number), [1, 8])
  assert.ok(created.every(c => c.body.includes(triage) && /@agent-bebop/.test(c.body)))
})

test(`${pkg}: at most five issues are handed off per run`, async () => {
  const created = await runHandoff({ issues: Array.from({ length: 8 }, (_, i) => issue(i + 1, 24)) })
  assert.equal(created.length, 5)
})

const release = load('release.yml')
const steps = release.jobs.publish.steps
const reportStep = steps.find(step => step.name === 'Hand referenced Issues to Bebop')
async function runReport({ issues = '', commits = '', pullsByCommit = {}, closing = {}, ...input }) {
  const { github, created } = fakeGithub(input)
  github.rest.repos = { listPullRequestsAssociatedWithCommit: async ({ commit_sha }) => ({ data: pullsByCommit[commit_sha] ?? [] }) }
  github.graphql = async (_query, { number }) => ({ repository: { pullRequest: { closingIssuesReferences: { nodes: closing[number] ?? [] } } } })
  const saved = { ISSUES: process.env.ISSUES, COMMITS: process.env.COMMITS }
  process.env.ISSUES = issues; process.env.COMMITS = commits
  try { await new AsyncFunction('github', 'context', 'core', reportStep.with.script)(github, { repo, ref: 'refs/tags/v1.2.3' }, core) }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  return created
}

test(`${pkg}: release keeps its publishing permissions, adds issue write and full history`, () => {
  assert.deepEqual(release.permissions, { contents: 'write', 'id-token': 'write', issues: 'write' })
  assert.equal(steps[0].with['fetch-depth'], 0)
  const collect = steps.find(step => step.id === 'refs')
  assert.ok(collect.run.includes('(refs|close[sd]?|fix(e[sd])?|resolve[sd]?):? +$GITHUB_REPOSITORY#[0-9]+'))
  assert.match(reportStep.uses, /^actions\/github-script@[a-f0-9]{40}/)
})

test(`${pkg}: release report covers open and completed-closed issues once, skips PRs and not-planned`, async () => {
  const marker = '<!-- bebop:release-report v1.2.3 -->'
  const created = await runReport({ issues: '1 2 3 4 5 6',
    get: { 1: { state: 'open' }, 2: { state: 'closed', state_reason: 'completed' }, 3: { state: 'open', pull_request: {} },
      4: { state: 'open' }, 6: { state: 'closed', state_reason: 'not_planned' } },
    comments: { 4: [{ user: { login: 'github-actions[bot]' }, body: marker }] },
  })
  assert.deepEqual(created.map(c => c.issue_number), [1, 2])
  assert.ok(created.every(c => c.body.includes(marker) && /@agent-bebop v1\.2\.3 has been released/.test(c.body)))
})

test(`${pkg}: issues closed by merged PRs in the release are reported, other repositories ignored`, async () => {
  const created = await runReport({ commits: 'a b',
    pullsByCommit: { a: [{ number: 10, merged_at: '2026-11-10' }, { number: 11, merged_at: null }] },
    closing: { 10: [{ number: 7, repository: { nameWithOwner: `prgrmrwy/${pkg}` } }, { number: 8, repository: { nameWithOwner: 'prgrmrwy/ohmydsh' } }],
      11: [{ number: 9, repository: { nameWithOwner: `prgrmrwy/${pkg}` } }] },
    get: { 7: { state: 'closed', state_reason: 'completed' }, 8: { state: 'open' }, 9: { state: 'open' } },
  })
  assert.deepEqual(created.map(c => c.issue_number), [7])
})
}
