const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const patchPath = join(__dirname, 'native-managed-effects.patch')
const patch = readFileSync(patchPath, 'utf8')
const expectedFiles = [
  'packages/subagent/tool-subagent/src/index.ts',
  'packages/subagent/tool-subagent-control/src/index.ts',
  'packages/workflow/tool-workflow/src/index.ts',
  'packages/workflow/tool-ralph/src/index.ts',
]
const sections = [...patch.matchAll(/^diff --git a\/([^ ]+) b\/([^\n]+)$/gm)]

assert.deepEqual(sections.map((section) => section[1]).sort(), [...expectedFiles].sort())
assert.ok(patch.includes("Symbol.for('dsh.tool.managed-effect')"))
assert.ok(patch.includes("'communication'))"))
assert.ok(!patch.includes("'communication')))"))
assert.equal((patch.match(/^\+\s*\}\), 'delegation'\)\)\s*$/gm) ?? []).length, 3)
assert.ok(patch.includes("'send_message'"))
assert.ok(patch.includes("'interrupt_agent'"))
assert.ok(patch.includes("name: toolName"))
assert.ok(patch.includes("name: 'ralph'"))
assert.ok(patch.includes('Object.defineProperty(definition.execute'))

console.log('native-managed-effects patch structure checks passed (no live tool execution performed)')
