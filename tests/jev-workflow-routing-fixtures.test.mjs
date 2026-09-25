import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const recorder = new URL('../skills/jev-workflow-router/recorder.mjs', import.meta.url)
const skill = new URL('../skills/jev-workflow-router/SKILL.md', import.meta.url)
const ROUTES = ['direct', 'standard-openspec', 'anvil', 'spec-superflow']
const WORKFLOW_KEYS = [
  'standard-openspec',
  'anvil',
  'spec-superflow',
  'ask_user',
  'investigate',
  'none',
]

async function temporaryHome(t) {
  const directory = await mkdtemp(join(tmpdir(), 'jev-routing-fixtures-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function runRecorder(home, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [recorder.pathname, ...args], {
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_JEV_WORKFLOW_ROUTER_DISABLED: '',
        DSH_JEV_WORKFLOW_ROUTER_MAX_COUNT: '100',
        DSH_JEV_WORKFLOW_ROUTER_MAX_BYTES: '1048576',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', code => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input))
  })
}

async function records(home) {
  const path = join(home, 'state', 'jev-workflow-router', 'records.v1.jsonl')
  const text = await readFile(path, 'utf8')
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function documentedCandidateCatalog(source) {
  return [...source.matchAll(/^\| `([^`]+)` \|/gmu)].map(match => match[1])
}

// This applies only the deterministic authority documented in SKILL.md. It
// deliberately has no recommendation argument: recommendation is an observed
// label, never an input to actual control flow.
function predeterminedActualRoute(fixture) {
  if (fixture.features.explicitRoute !== 'unknown') {
    return { route: fixture.features.explicitRoute, source: 'user-explicit' }
  }
  if (fixture.features.existingChange) {
    return { route: fixture.existingRoute, source: 'existing-change' }
  }
  if (fixture.nonImplementation) return { route: 'direct', source: 'agent' }
  return { route: fixture.agentRoute, source: 'agent' }
}

function eligibleCandidates(fixture, catalog) {
  const unavailable = new Set(fixture.unavailableCandidates ?? [])
  const candidates = catalog.filter(candidate => !unavailable.has(candidate))
  if (fixture.activeManagedWorktreeSession && !fixture.verifiedSsfFirewall) {
    const index = candidates.indexOf('spec-superflow')
    if (index !== -1) candidates.splice(index, 1)
  }
  if (!candidates.includes('standard-openspec')) candidates.push('standard-openspec')
  return ROUTES.filter(route => candidates.includes(route))
}

function recommendation(choice, eligible, options = {}) {
  const formal = choice !== 'direct'
  const classificationProbabilities = formal
    ? { direct: 0.05, 'formal-workflow': 0.9, 'manual-review': 0.05 }
    : { direct: 0.9, 'formal-workflow': 0.05, 'manual-review': 0.05 }
  const workflowProbabilities = Object.fromEntries(WORKFLOW_KEYS.map(key => [key, 0]))

  if (formal) {
    const eligibleWorkflows = eligible.filter(candidate => candidate !== 'direct')
    if (eligibleWorkflows.includes(choice)) {
      const alternatives = eligibleWorkflows.filter(candidate => candidate !== choice)
      workflowProbabilities[choice] = alternatives.length === 0 ? 0.9 : 0.75
      for (const alternative of alternatives) {
        workflowProbabilities[alternative] = 0.15 / alternatives.length
      }
      workflowProbabilities.ask_user = 0.05
      workflowProbabilities.investigate = 0.03
      workflowProbabilities.none = 0.02
    } else {
      // Synthetic bad provider output: it assigns most probability to a choice
      // removed by deterministic health/session policy. The recorder must not
      // repair this into an executable recommendation.
      if (WORKFLOW_KEYS.includes(choice)) workflowProbabilities[choice] = 0.8
      workflowProbabilities['standard-openspec'] = 0.1
      workflowProbabilities.ask_user = 0.05
      workflowProbabilities.investigate = 0.03
      workflowProbabilities.none = 0.02
    }
  }

  return {
    changeNecessity: formal ? 'formal-workflow' : 'direct',
    workflow: choice,
    classificationProbabilities,
    workflowProbabilities,
    confidence: 0.9,
    margin: 0.6,
    escape: false,
    requirementChecks: {
      eligibleChoice: true,
      completeProbabilities: true,
      confidenceMet: true,
      marginMet: true,
      safetyCompatible: options.safetyCompatible ?? true,
    },
    status: 'auto-candidate',
  }
}

function feature(overrides) {
  return {
    intent: 'unknown',
    scope: 'unknown',
    behaviorChange: false,
    persistence: false,
    concurrency: false,
    existingChange: false,
    safetyGateConflict: false,
    externalSystems: 0,
    safetyRisk: 'none',
    migrationRisk: 'none',
    explicitRoute: 'unknown',
    ...overrides,
  }
}

const FIXTURES = [
  {
    name: 'English explanation stays direct',
    language: 'en',
    sample: 'Explain why this cache is safe; do not change code.',
    nonImplementation: true,
    agentRoute: 'direct',
    features: feature({ intent: 'explanation', scope: 'none' }),
    recommendation: 'direct',
    expectedStatus: 'auto-candidate',
  },
  {
    name: '中文调研不强迫创建 change',
    language: 'zh',
    sample: '调研现有认证流程，只给结论，不修改代码。',
    nonImplementation: true,
    agentRoute: 'direct',
    features: feature({ intent: 'research', scope: 'none', externalSystems: 1 }),
    recommendation: 'direct',
    expectedStatus: 'auto-candidate',
  },
  {
    name: '中文小修保持 direct',
    language: 'zh',
    sample: '修正一个局部拼写错误并补对应断言。',
    agentRoute: 'direct',
    features: feature({ intent: 'bugfix', scope: 'small', behaviorChange: true }),
    recommendation: 'direct',
    expectedStatus: 'auto-candidate',
  },
  {
    name: 'ordinary English feature uses standard OpenSpec',
    language: 'en',
    sample: 'Add one ordinary settings toggle in a single module.',
    agentRoute: 'standard-openspec',
    features: feature({ intent: 'feature', scope: 'single-module', behaviorChange: true }),
    recommendation: 'standard-openspec',
    expectedStatus: 'auto-candidate',
  },
  {
    name: '中文多模块 planned 工作走 spec-superflow',
    language: 'zh',
    sample: '跨三个模块实现已明确范围的功能，需要计划、恢复与最终 review。',
    agentRoute: 'spec-superflow',
    features: feature({ intent: 'feature', scope: 'multi-module', behaviorChange: true }),
    recommendation: 'spec-superflow',
    expectedStatus: 'auto-candidate',
  },
  {
    name: 'English security work keeps Anvil assurance',
    language: 'en',
    sample: 'Change authorization checks on a security-sensitive boundary.',
    agentRoute: 'anvil',
    features: feature({
      intent: 'security', scope: 'multi-module', behaviorChange: true, safetyRisk: 'high',
    }),
    recommendation: 'anvil',
    expectedStatus: 'auto-candidate',
  },
  {
    name: '中文不可逆迁移使用 Anvil',
    language: 'zh',
    sample: '设计并实施不可逆的数据迁移。',
    agentRoute: 'anvil',
    features: feature({
      intent: 'migration', scope: 'multi-module', behaviorChange: true,
      persistence: true, migrationRisk: 'irreversible',
    }),
    recommendation: 'anvil',
    expectedStatus: 'auto-candidate',
  },
  {
    name: 'English persistence change uses Anvil',
    language: 'en',
    sample: 'Alter durable state layout and recovery semantics.',
    agentRoute: 'anvil',
    features: feature({
      intent: 'feature', scope: 'single-module', behaviorChange: true, persistence: true,
    }),
    recommendation: 'anvil',
    expectedStatus: 'auto-candidate',
  },
  {
    name: '中文并发语义变更使用 Anvil',
    language: 'zh',
    sample: '修改并发写入和锁恢复语义。',
    agentRoute: 'anvil',
    features: feature({
      intent: 'feature', scope: 'multi-module', behaviorChange: true, concurrency: true,
    }),
    recommendation: 'anvil',
    expectedStatus: 'auto-candidate',
  },
  {
    name: 'existing English change keeps its recorded control plane',
    language: 'en',
    sample: 'Continue implementing the already-created standard OpenSpec change.',
    existingRoute: 'standard-openspec',
    agentRoute: 'anvil',
    features: feature({
      intent: 'feature', scope: 'multi-module', behaviorChange: true, existingChange: true,
    }),
    recommendation: 'anvil',
    expectedStatus: 'auto-candidate',
  },
  {
    name: '中文显式选路优先于推荐',
    language: 'zh',
    sample: '明确使用 spec-superflow，不要改成其他流程。',
    agentRoute: 'standard-openspec',
    features: feature({
      intent: 'feature', scope: 'multi-module', behaviorChange: true,
      explicitRoute: 'spec-superflow',
    }),
    recommendation: 'anvil',
    expectedStatus: 'auto-candidate',
  },
  {
    name: 'unavailable Anvil is removed and cannot be repaired into a choice',
    language: 'en',
    sample: 'Anvil health check failed before routing an assured change.',
    unavailableCandidates: ['anvil'],
    agentRoute: 'standard-openspec',
    features: feature({
      intent: 'security', scope: 'single-module', behaviorChange: true, safetyRisk: 'high',
    }),
    recommendation: 'anvil',
    expectedStatus: 'needs-review',
    expectedRecordedWorkflow: 'unknown',
  },
  {
    name: '中文安全门禁冲突保守降级为 needs-review',
    language: 'zh',
    sample: '推荐直接修改，但现有安全门禁要求更严格流程。',
    agentRoute: 'anvil',
    features: feature({
      intent: 'security', scope: 'small', behaviorChange: true,
      safetyGateConflict: true, safetyRisk: 'high',
    }),
    recommendation: 'direct',
    safetyCompatible: false,
    expectedStatus: 'needs-review',
  },
  {
    name: 'managed Worktree Session removes unsafe spec-superflow candidate',
    language: 'en',
    sample: 'A managed Worktree Session is active without an external SSF command firewall.',
    activeManagedWorktreeSession: true,
    verifiedSsfFirewall: false,
    agentRoute: 'standard-openspec',
    features: feature({ intent: 'feature', scope: 'multi-module', behaviorChange: true }),
    recommendation: 'spec-superflow',
    expectedStatus: 'needs-review',
    expectedRecordedWorkflow: 'unknown',
  },
]

test('documented deterministic router policy is closed and mechanically inspectable', async () => {
  const source = await readFile(skill, 'utf8')
  assert.deepEqual(documentedCandidateCatalog(source), ROUTES)
  assert.match(source, /explicit user choice[\s\S]*controls/iu)
  assert.match(source, /existing change keeps its recorded control plane\/schema/iu)
  assert.match(source, /non-implementation request is not forced into a change/iu)
  assert.match(source, /remove unavailable or unhealthy community candidates/iu)
  assert.match(source, /active managed Worktree Session[\s\S]*remove `spec-superflow`/iu)
  assert.match(source, /lighter recommendation cannot weaken them/iu)
  assert.match(source, /actual route[\s\S]*not the Jev recommendation/iu)
})

test('table-driven English and Chinese fixtures preserve actual route and conservative records', async t => {
  const source = await readFile(skill, 'utf8')
  const catalog = documentedCandidateCatalog(source)
  assert.ok(FIXTURES.some(fixture => fixture.language === 'en'))
  assert.ok(FIXTURES.some(fixture => fixture.language === 'zh'))
  for (const fixture of FIXTURES) {
    if (fixture.language === 'zh') assert.match(fixture.sample, /\p{Script=Han}/u)
    if (fixture.language === 'en') assert.doesNotMatch(fixture.sample, /\p{Script=Han}/u)
  }

  for (const fixture of FIXTURES) {
    await t.test(fixture.name, async t => {
      const home = await temporaryHome(t)
      const eligible = eligibleCandidates(fixture, catalog)
      const authority = predeterminedActualRoute(fixture)

      assert.ok(eligible.includes('standard-openspec'), 'standard OpenSpec fallback must remain')
      assert.deepEqual(
        predeterminedActualRoute({ ...fixture, recommendation: 'malicious-counterfactual' }),
        authority,
        'actual route derivation must not accept a recommendation input',
      )

      const primaryInput = {
        // These fields are intentionally not trusted by the recorder. The
        // actual route is associated only afterward from authoritative facts.
        actualRoute: fixture.recommendation,
        overrideSource: 'recommendation',
        features: fixture.features,
        eligibleCandidates: eligible,
        recommendation: recommendation(fixture.recommendation, eligible, {
          safetyCompatible: fixture.safetyCompatible,
        }),
        metrics: { latencyMs: 5, usage: { input: 1, output: 1, total: 2 } },
        errorCategory: 'none',
      }
      const recorded = await runRecorder(home, ['record'], primaryInput)
      assert.equal(recorded.code, 0, recorded.stderr)
      const observationId = JSON.parse(recorded.stdout).observationId
      let record = (await records(home)).find(item => item.observationId === observationId)

      assert.ok(record)
      assert.deepEqual(record.eligibleCandidates, eligible)
      assert.equal(record.actualRoute, 'unknown')
      assert.equal(record.overrideSource, 'unknown')
      assert.equal(record.recommendation.status, fixture.expectedStatus)
      assert.equal(
        record.recommendation.workflow,
        fixture.expectedRecordedWorkflow ?? fixture.recommendation,
      )

      const labelled = await runRecorder(
        home,
        ['label', observationId, authority.route, authority.source],
      )
      assert.equal(labelled.code, 0, labelled.stderr)
      record = (await records(home)).find(item => item.observationId === observationId)
      assert.equal(record.actualRoute, authority.route)
      assert.equal(record.overrideSource, authority.source)
      assert.equal(record.recommendation.status, fixture.expectedStatus)

      const counterfactualChoice = eligible.find(candidate => (
        candidate !== authority.route && candidate !== fixture.recommendation
      )) ?? (authority.route === 'direct' ? 'standard-openspec' : 'direct')
      const counterfactual = await runRecorder(home, ['record'], {
        features: fixture.features,
        eligibleCandidates: eligible,
        recommendation: recommendation(counterfactualChoice, eligible),
        metrics: { latencyMs: 5, usage: { input: 1, output: 1, total: 2 } },
        errorCategory: 'none',
      })
      assert.equal(counterfactual.code, 0, counterfactual.stderr)
      const counterfactualId = JSON.parse(counterfactual.stdout).observationId
      let counterfactualRecord = (await records(home))
        .find(item => item.observationId === counterfactualId)
      assert.equal(counterfactualRecord.actualRoute, 'unknown')
      assert.notEqual(counterfactualRecord.recommendation.workflow, fixture.recommendation)

      const counterfactualLabel = await runRecorder(
        home,
        ['label', counterfactualId, authority.route, authority.source],
      )
      assert.equal(counterfactualLabel.code, 0, counterfactualLabel.stderr)
      counterfactualRecord = (await records(home))
        .find(item => item.observationId === counterfactualId)
      assert.equal(counterfactualRecord.actualRoute, authority.route)
      assert.equal(counterfactualRecord.overrideSource, authority.source)
    })
  }
})
