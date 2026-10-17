import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

export interface BoundaryViolation {
  file: string
  specifier: string
}

export function scanImports(directory: string): BoundaryViolation[] {
  const root = resolve(directory)
  let packageRoot = root
  while (!existsSync(resolve(packageRoot, 'package.json')) && dirname(packageRoot) !== packageRoot) {
    packageRoot = dirname(packageRoot)
  }
  const violations: BoundaryViolation[] = []

  const forbidden = (specifier: string, file: string): boolean => {
    if (specifier.startsWith('@deepseek-ai/')) return true
    if (specifier.startsWith('.') || isAbsolute(specifier)) {
      const target = resolve(dirname(file), specifier)
      const fromRoot = relative(packageRoot, target)
      return fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)
    }
    return specifier.startsWith('scripts/') || specifier.startsWith('packages/')
  }

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
        const add = (specifier: string): void => {
          if (forbidden(specifier, file)) violations.push({ file: relative(root, file), specifier })
        }
        const visit = (node: ts.Node): void => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            add(node.moduleSpecifier.text)
          } else if (ts.isCallExpression(node) && node.arguments.length === 1 && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            if ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
              add(node.arguments[0].text)
            }
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
  }

  walk(root)
  if (root === packageRoot || root === resolve(packageRoot, 'src')) {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    for (const [name, specifier] of Object.entries(pkg.dependencies ?? {})) {
      const localPath = specifier.startsWith('file:') ? specifier.slice(5) : specifier
      const pointsOutsidePackage = localPath.startsWith('.') || isAbsolute(localPath)
        ? (() => {
            const fromRoot = relative(packageRoot, resolve(packageRoot, localPath))
            return fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)
          })()
        : false
      if (name.startsWith('@deepseek-ai/') || name.startsWith('packages/') || name.startsWith('scripts/') || pointsOutsidePackage) {
        violations.push({ file: 'package.json', specifier: name })
      }
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier))
}
