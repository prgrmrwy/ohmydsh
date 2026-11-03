#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { readRegular } from '../eval/freeze.js'
import { recomputeRetrieval } from '../eval/retrieval/freeze.js'
import { assertRecomputeDirectory, runRetrieval, type RetrievalRunner } from '../eval/retrieval/run.js'

export interface RetrievalCliDependencies {
  readonly home?: string
  readonly runner?: RetrievalRunner
  readonly stdout?: (text: string) => void
  readonly stderr?: (text: string) => void
  readonly runId?: string
}
const HELP = `Usage:
  dsh-memex-eval-retrieval --library <home> --goldset <json> --set dev|holdout
  dsh-memex-eval-retrieval --recompute <runDir>

Options:
  --backend lexical              Only supported backend (default: lexical)
  --expected-hash <sha256>        Require the prepared snapshot hash
  --exclude-category <category>  Append a category exclusion (repeatable)
  --exclude-prefix <prefix>      Append a slug prefix exclusion (repeatable)
  --distractor <slug=markdown>    Add a new distractor card (repeatable)
  --help                         Show this help

Outputs: ~/.dsh-memex-eval/retrieval/<run-id>/ (exclusive, private files).
Exit codes: 0 = ok; 1 = incomplete/invalid or rejected input.
`

export async function main(argv: readonly string[], dependencies: RetrievalCliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? (text => process.stdout.write(text + '\n'))
  const stderr = dependencies.stderr ?? (text => process.stderr.write(text + '\n'))
  try {
    const { values } = parseArgs({ args: [...argv], strict: true, allowPositionals: false, options: {
      library: { type: 'string' }, goldset: { type: 'string' }, set: { type: 'string' }, backend: { type: 'string' },
      recompute: { type: 'string' }, 'expected-hash': { type: 'string' },
      'exclude-category': { type: 'string', multiple: true }, 'exclude-prefix': { type: 'string', multiple: true },
      distractor: { type: 'string', multiple: true }, help: { type: 'boolean' },
    } })
    if (values.help) { stdout(HELP); return 0 }
    if (values.backend !== undefined && values.backend !== 'lexical') throw new TypeError('This version only supports lexical')
    const home = dependencies.home ?? homedir()
    if (values.recompute) {
      if (Object.keys(values).some(key => key !== 'recompute')) throw new TypeError('--recompute cannot be combined with run options')
      const reportDir = assertRecomputeDirectory(home, values.recompute)
      const result = recomputeRetrieval(values.recompute, reportDir)
      stdout(`${result.report.status}: ${result.markdownPath}`)
      return result.report.status === 'ok' ? 0 : 1
    }
    if (!values.library || !values.goldset) throw new TypeError('--library and --goldset are required')
    if (values.set !== 'dev' && values.set !== 'holdout') throw new TypeError('--set is required (dev or holdout)')
    const distractors = (values.distractor ?? []).map(value => {
      const equals = value.indexOf('=')
      const path = equals < 0 ? value : value.slice(equals + 1)
      const slug = equals < 0 ? basename(path, '.md') : value.slice(0, equals)
      return { slug, content: readRegular(path).toString('utf8') }
    })
    const result = await runRetrieval({ home, library: values.library, goldset: values.goldset, set: values.set, distractors,
      ...(values.backend ? { backend: values.backend } : {}),
      ...(values['expected-hash'] ? { expectedHash: values['expected-hash'] } : {}),
      ...(values['exclude-category'] ? { excludeCategories: values['exclude-category'] } : {}),
      ...(values['exclude-prefix'] ? { excludePrefixes: values['exclude-prefix'] } : {}),
      ...(dependencies.runner ? { runner: dependencies.runner } : {}), ...(dependencies.runId ? { runId: dependencies.runId } : {}),
    })
    stdout(`${result.report.status}: ${result.markdownPath}`)
    return result.report.status === 'ok' ? 0 : 1
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2))
