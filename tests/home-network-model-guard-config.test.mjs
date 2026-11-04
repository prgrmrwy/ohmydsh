import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

// This deployment wiring spans the manifest, a patch and the package, so it is
// checked here at the repository root. The package itself stays self-contained:
// its tests no longer read `dsh.yaml` or `patches/`.

const MANIFEST = parse(readFileSync(new URL('../dsh.yaml', import.meta.url), 'utf8'))
const PATCH = parse(readFileSync(new URL('../patches/home-network-model-guard-config.yml', import.meta.url), 'utf8'))

const MAGPIE_ROUTES = [
  'dsh-magpie-connector-claude',
  'dsh-magpie-connector-codex',
  'dsh-magpie-connector-opencode-go',
  'dsh-magpie-connector-deepseek',
  'dsh-magpie-connector-other',
]

test('the deployment default exempts each Magpie owner route and drops the retired publisher entry', () => {
  assert.equal(MANIFEST.customizations.some((entry) => entry.id === 'dsh-magpie-connect'), false)
  const entry = MANIFEST.customizations.find((candidate) => candidate.id === 'home-network-model-guard-config')
  assert.ok(entry, 'home-network-model-guard-config must stay declared')
  assert.equal(entry.enabled, true)
  assert.deepEqual(PATCH, [{
    id: 'dsh-home-network-model-guard',
    name: 'dsh-home-network-model-guard',
    config: { exemptProviders: MAGPIE_ROUTES },
  }])
})
