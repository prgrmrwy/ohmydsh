/**
 * Fail the client build if any runtime dependency was left as a bare
 * `require()`.
 *
 * The Web client is loaded through DSH's `client-modules` loader, whose
 * `require` only knows the modules the shell exposes (`react`, cordis, …).
 * A dependency that is missing at build time is silently externalized by the
 * bundler (rolldown logs "treating it as an external dependency" and keeps
 * going), so the build "succeeds" and the browser then fails to activate the
 * plugin with "missed the module table". That happened to `lottie-web` on a
 * machine that had not run `npm install` after pulling.
 *
 * This check turns that class of drift into a build-time failure with the
 * action that fixes it. Run only after `tsdown` has written `lib/client.js`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Modules the DSH shell exposes to client bundles; keeping them external is correct. */
const SHELL_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
])

const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))

let code
try {
  code = readFileSync(bundlePath, 'utf8')
} catch {
  console.error(
    `[dsh-pet] client bundle check: ${bundlePath} is missing. Run \`npm run build\` from packages/dsh-pet.`,
  )
  process.exit(1)
}

/** Bare requires emitted by the bundler for non-shell modules. */
const bareRequires = new Set()
for (const match of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
  const id = match[1]
  if (id === undefined) continue
  if (SHELL_MODULES.has(id)) continue
  if (id.startsWith('.') || id.startsWith('/') || id.startsWith('node:')) continue
  bareRequires.add(id)
}

if (bareRequires.size > 0) {
  console.error(
    '[dsh-pet] client bundle check FAILED: the bundle still contains runtime requires for ' +
      `non-shell modules: ${[...bareRequires].join(', ')}.\n` +
      '  Those dependencies must be bundled into lib/client.js. The usual cause is that the ' +
      'repository root was not installed after a dependency change:\n' +
      '    cd <repo root> && npm install   # or: npm ci\n' +
      '  Then rebuild: dsh build\n' +
      '  (A missing module is silently externalized by the bundler; this guard makes it fail here.)',
  )
  process.exit(1)
}

// Positive control: the bundled player must actually be in the file, otherwise
// an import-graph refactor could drop it while all requires still look clean.
if (!/lottie_light_min|Bodymovin/.test(code)) {
  console.error(
    '[dsh-pet] client bundle check FAILED: bundled Lottie player is missing from lib/client.js. ' +
      'Run `cd <repo root> && npm install` and rebuild.',
  )
  process.exit(1)
}

console.log('[dsh-pet] client bundle check passed: no stray runtime requires, player bundled.')
