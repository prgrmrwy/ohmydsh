import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const checkout = process.env.DSH_COMPAT_SUBAGENT_CHECKOUT
if (!checkout) throw new Error('Set DSH_COMPAT_SUBAGENT_CHECKOUT to the isolated pinned source checkout')
const requireSource = createRequire(resolve(checkout, 'package.json'))
const { standardDecoratorPlugin, vitestExecArgv } = await import(pathToFileURL(resolve(checkout, 'vitest.shared.ts')).href)
const tests = fileURLToPath(new URL('../../test/', import.meta.url))
const ts = requireSource('typescript')
const paths = ts.readConfigFile(resolve(checkout, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths
const aliases = Object.entries(paths).map(([name, targets]) => ({
  find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '(.*)')}$`),
  replacement: resolve(checkout, targets[0]).replace('*', '$1'),
}))
for (const name of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'vitest', '@testing-library/react']) {
  const owner = name.startsWith('react') ? createRequire(resolve(checkout, 'packages/client/ui-model-selection/package.json')) : requireSource
  aliases.push({ find: new RegExp(`^${name}$`), replacement: name === 'vitest' ? resolve(checkout, 'node_modules/vitest/dist/index.js') : owner.resolve(name) })
}
export default {
  root: checkout,
  plugins: [standardDecoratorPlugin()],
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: [{ find: '#model-source', replacement: resolve(checkout, 'packages') }, ...aliases] },
  server: { fs: { allow: [checkout, tests] } },
  test: {
    include: [`${tests}/model-display-*.spec.{ts,tsx}`],
    execArgv: vitestExecArgv,
    testTimeout: 15000,
    fileParallelism: false,
  },
}
