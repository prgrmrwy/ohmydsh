import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

const workflow = yaml.load(readFileSync(new URL('../.github/workflows/dependabot-bebop.yml', import.meta.url), 'utf8'))
const script = workflow.jobs.handoff.steps[0].with.script
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const context = { repo: { owner: 'prgrmrwy', repo: 'ohmydsh' }, issue: { number: 42 } }
const marker = '<!-- bebop:dependabot-follow-up -->'

async function run(comments) {
  const created = []
  const github = {
    paginate: async (_method, params) => {
      assert.deepEqual(params, { ...context.repo, issue_number: 42 })
      return comments
    },
    rest: { issues: { listComments() {}, createComment: async body => created.push(body) } },
  }
  await new AsyncFunction('github', 'context', script)(github, context)
  return created
}

test('privileged handoff only handles same-repository non-draft Dependabot PRs without executing PR code', () => {
  assert.deepEqual(workflow.on.pull_request_target.types, ['opened', 'reopened', 'ready_for_review'])
  assert.deepEqual(workflow.permissions, { contents: 'read', issues: 'write' })
  assert.match(workflow.jobs.handoff.if, /pull_request.user.login == 'dependabot\[bot\]'/)
  assert.match(workflow.jobs.handoff.if, /pull_request.head.repo.full_name == github.repository/)
  assert.match(workflow.jobs.handoff.if, /!github.event.pull_request.draft/)
  assert.equal(workflow.jobs.handoff.steps.length, 1)
  assert.match(workflow.jobs.handoff.steps[0].uses, /^actions\/github-script@[a-f0-9]{40}$/)
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
})

test('new handoff mentions Bebop, requests validation and fixes, and leaves merge to the person', async () => {
  const [comment] = await run([])
  assert.equal(comment.issue_number, 42)
  assert.ok(comment.body.includes(marker))
  assert.match(comment.body, /@agent-bebop/)
  assert.match(comment.body, /original PR branch/)
  assert.match(comment.body, /Do not approve or merge/)
})

test('rerun does not duplicate a handoff from github-actions', async () => {
  assert.deepEqual(await run([{ user: { login: 'github-actions[bot]' }, body: marker }]), [])
})

test('an unrelated user cannot suppress handoff by copying its marker', async () => {
  assert.equal((await run([{ user: { login: 'outsider' }, body: marker }])).length, 1)
})
