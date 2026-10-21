import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CollabError } from '../model/index.js'

const text = readFileSync(new URL('./v1.md', import.meta.url), 'utf8')

export const defaultConvention = {
  version: '1',
  sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  text,
} as const

export function readConvention(version: string): string {
  if (version !== defaultConvention.version) throw new CollabError('COLLAB_CONVENTION_UNKNOWN')
  return defaultConvention.text
}
