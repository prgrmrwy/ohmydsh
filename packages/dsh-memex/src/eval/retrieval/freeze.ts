import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { SearchHit } from '../../run/types.js'
import { durableWrite, readRegular } from '../freeze.js'
import { computeRetrievalReport, renderRetrievalReport, type ReportInput } from './metrics.js'

export interface FrozenRetrieval extends ReportInput {
  readonly version: string
  readonly kernelVersion: string
  readonly config: { readonly nestedSlugs?: boolean }
  readonly queryPreprocessingVersion: string
  readonly limit: number
  readonly exclusions: { readonly categories: readonly string[]; readonly prefixes: readonly string[]; readonly slugs: readonly string[] }
  readonly manifest: readonly { readonly path: string; readonly sha256: string }[]
  readonly manifestHash: string
}
export function returnedCharacters(hits: readonly Pick<SearchHit, 'title' | 'summary'>[]): number {
  return hits.reduce((sum, hit) => sum + [...`${hit.title}\n${hit.summary}`].length, 0)
}

function hash(data: unknown): string { return createHash('sha256').update(JSON.stringify(data)).digest('hex') }

function checkProtocol(data: FrozenRetrieval): void {
  if (data.version !== 'retrieval-v1') throw new Error(`Unsupported retrieval protocol: ${data.version}`)
  if (data.costs.quantileVersion !== 'nearest-rank-v1') throw new Error(`Unsupported quantile protocol: ${data.costs.quantileVersion}`)
  if (data.costs.characterCountVersion !== 'chars-v1') throw new Error(`Unsupported character protocol: ${data.costs.characterCountVersion}`)
}

export function freezeRetrieval(runDir: string, data: FrozenRetrieval): void {
  checkProtocol(data)
  durableWrite(join(runDir, 'frozen.json'), JSON.stringify({ data, sha256: hash(data) }, null, 2) + '\n')
}

export function readFrozenRetrieval(runDir: string): FrozenRetrieval {
  const frozen = JSON.parse(readRegular(join(runDir, 'frozen.json')).toString()) as { data: FrozenRetrieval; sha256: string }
  if (!frozen.data || !/^[a-f0-9]{64}$/.test(frozen.sha256) || hash(frozen.data) !== frozen.sha256) throw new Error('Frozen retrieval hash mismatch')
  checkProtocol(frozen.data)
  return frozen.data
}

export function writeRetrievalReport(runDir: string, data: FrozenRetrieval, recomputed = false) {
  checkProtocol(data)
  const report = { ...computeRetrievalReport(data), version: data.version, kernelVersion: data.kernelVersion, config: data.config,
    queryPreprocessingVersion: data.queryPreprocessingVersion, limit: data.limit, exclusions: data.exclusions,
    manifest: data.manifest, manifestHash: data.manifestHash, distractors: data.distractors, protocols: data.costs,
  }
  const name = `report${data.questions[0]?.set === 'holdout' ? '-holdout' : ''}${recomputed ? `-recomputed-${randomUUID()}` : ''}`
  const jsonPath = join(runDir, `${name}.json`)
  const markdownPath = join(runDir, `${name}.md`)
  durableWrite(jsonPath, JSON.stringify(report, null, 2) + '\n')
  durableWrite(markdownPath, renderRetrievalReport(report) + [
    '', `运行协议：${data.version}；内核：${data.kernelVersion}；预处理：${data.queryPreprocessingVersion}；K=${data.limit}`,
    `清单整体哈希：${data.manifestHash}`, `白名单配置：${JSON.stringify(data.config)}`,
    `排除 category：${data.exclusions.categories.join(', ')}`, `排除前缀：${data.exclusions.prefixes.join(', ')}`,
    `排除卡：${data.exclusions.slugs.join(', ') || '无'}`, '', '| 清单路径 | SHA-256 |', '| --- | --- |',
    ...data.manifest.map(entry => `| ${entry.path} | ${entry.sha256} |`), '',
    ...data.distractors.map(card => `干扰卡：${card.slug} (${card.sha256})`), '',
  ].join('\n'))
  return { jsonPath, markdownPath, report }
}

export function recomputeRetrieval(runDir: string, reportDir = runDir): ReturnType<typeof writeRetrievalReport> {
  return writeRetrievalReport(reportDir, readFrozenRetrieval(runDir), true)
}
