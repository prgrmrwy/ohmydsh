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

test(`${pkg}: only open human issues older than 12 hours without a maintainer or agent reply are handed off once`, async () => {
  const created = await runHandoff({
    issues: [issue(1, 13), issue(2, 11), issue(3, 20, 'prgrmrwy'), issue(4, 20, 'dependabot[bot]'), issue(5, 20, 'reporter', { pull_request: {} }),
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
async function runReport(env, input) {
  const { github, created } = fakeGithub(input)
  const previous = process.env.ISSUES
  process.env.ISSUES = env
  try { await new AsyncFunction('github', 'context', 'core', reportStep.with.script)(github, { repo, ref: 'refs/tags/v1.2.3' }, core) }
  finally { if (previous === undefined) delete process.env.ISSUES; else process.env.ISSUES = previous }
  return created
}

test(`${pkg}: release keeps its publishing permissions, adds issue write and full history`, () => {
  assert.deepEqual(release.permissions, { contents: 'write', 'id-token': 'write', issues: 'write' })
  assert.equal(steps[0].with['fetch-depth'], 0)
  const collect = steps.find(step => step.id === 'refs')
  assert.match(collect.run, /refs:\? \+\$GITHUB_REPOSITORY#\[0-9\]\+/)
  assert.match(reportStep.uses, /^actions\/github-script@[a-f0-9]{40}/)
})

test(`${pkg}: release report hands each open referenced issue to Bebop once`, async () => {
  const marker = '<!-- bebop:release-report v1.2.3 -->'
  const created = await runReport('1 2 3 4 5', {
    get: { 1: { state: 'open' }, 2: { state: 'closed' }, 3: { state: 'open', pull_request: {} }, 4: { state: 'open' } },
    comments: { 4: [{ user: { login: 'github-actions[bot]' }, body: marker }] },
  })
  assert.deepEqual(created.map(c => c.issue_number), [1])
  assert.ok(created[0].body.includes(marker))
  assert.match(created[0].body, /@agent-bebop v1\.2\.3 has been released/)
})
}
