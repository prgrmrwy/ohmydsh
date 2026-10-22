import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CollabError } from '../model/index.js'

export interface Convention { readonly version: string; readonly sha256: string; readonly text: string }

const load = (version: string): Convention => {
  const text = readFileSync(new URL(`./v${version}.md`, import.meta.url), 'utf8')
  return { version, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), text }
}

/** Published conventions are immutable; new content ships only as a new version. */
export const conventions: Readonly<Record<string, Convention>> = Object.freeze({ '1': load('1'), '2': load('2') })

/** Latest version: recorded by spaces created without an explicit convention. */
export const defaultConvention = conventions['2']!

export function readConvention(version: string): string {
  if (!Object.hasOwn(conventions, version)) throw new CollabError('COLLAB_CONVENTION_UNKNOWN')
  return conventions[version]!.text
}
