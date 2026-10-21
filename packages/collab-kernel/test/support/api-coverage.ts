import ts from 'typescript'
import { fileURLToPath } from 'node:url'
export function serviceMethods(addUnsafe = false): string[] {
  const path = fileURLToPath(new URL('../../src/service/index.ts', import.meta.url))
  const fixture = `${path}.coverage.ts`
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  const text = `import { CollabService } from './index.js'; export interface CoverageFixture extends CollabService { ${addUnsafe ? 'unsafeWrite(): Promise<void>' : ''} }`
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === fixture ? ts.createSourceFile(name, text, options.target, true) : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([path, fixture], options, host)
  const checker = program.getTypeChecker(), source = program.getSourceFile(fixture)!
  const declaration = source.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'CoverageFixture')!
  const type = checker.getTypeAtLocation(declaration)
  const names = type.getProperties().filter(p => {
    const d = p.valueDeclaration!
    return !(ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) && checker.getTypeOfSymbolAtLocation(p, d).getCallSignatures().length > 0
  }).map(p => p.name)
  // Exact lifecycle exceptions: storage open/close cannot carry business commands.
  const excluded = new Set(['overview', 'readSince', 'project', 'readConvention', 'open', 'close'])
  return names.filter(n => !excluded.has(n)).sort()
}
export function missingAuthorization(keys: string[], addUnsafe = false): string[] { return serviceMethods(addUnsafe).filter(n => !keys.includes(n)) }
