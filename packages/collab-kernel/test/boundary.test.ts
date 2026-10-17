import { describe, expect, it } from 'vitest'
import { scanImports } from './support/boundary.js'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('dependency boundary', () => {
  it('boundary-01: real source has no host or repository dependencies', () => {
    expect(scanImports(resolve(packageRoot, 'src'))).toEqual([])
  })

  it('boundary-02: reports exactly one host import in the bad fixture', () => {
    expect(scanImports(resolve(packageRoot, 'test/fixtures/bad-import'))).toEqual([
      expect.objectContaining({ file: 'bad.ts', specifier: '@deepseek-ai/dsh-agent' }),
    ])
  })

  it('reports host imports across static, export, require, and dynamic import syntax', () => {
    expect(scanImports(resolve(packageRoot, 'test/fixtures/boundary-syntax'))).toEqual([
      expect.objectContaining({ specifier: '@deepseek-ai/dynamic-import' }),
      expect.objectContaining({ specifier: '@deepseek-ai/require' }),
      expect.objectContaining({ specifier: '@deepseek-ai/static-export' }),
      expect.objectContaining({ specifier: '@deepseek-ai/static-import' }),
    ])
  })

  it('rejects relative imports that escape the package', () => {
    expect(scanImports(resolve(packageRoot, 'test/fixtures/boundary-relative'))).toEqual([
      expect.objectContaining({ file: 'check.ts', specifier: '../../../synthetic-outside-package' }),
    ])
  })

  it('rejects file dependencies that point outside the package regardless of package name', () => {
    expect(scanImports(resolve(packageRoot, 'test/fixtures/boundary-dependency'))).toEqual([
      expect.objectContaining({ file: 'package.json', specifier: 'synthetic-other' }),
    ])
  })
})
