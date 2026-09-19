import { KernelError, type SearchHit } from './types.js'

export function parseSearch(stdout: string): SearchHit[] {
  const text = stdout.trim()
  if (!text) return []
  const blocks = text.split(/\n\s*\n(?=## )/)
  return blocks.map(block => {
    const lines = block.split('\n')
    const slugLine = lines.shift()
    const title = lines.shift()
    if (!slugLine?.startsWith('## ') || title === undefined) {
      throw new KernelError('unparseable', 'Unrecognized memex search output')
    }
    const slug = slugLine.slice(3).trim()
    const matchedIndex = lines.findIndex(line => line.startsWith('> Matched:'))
    const matched = matchedIndex >= 0 ? lines.splice(matchedIndex, 1)[0]!.slice('> Matched:'.length).trim() : undefined
    const summary = lines.join('\n').trim()
    return { slug, title: title.trim(), summary, ...(matched ? { matched } : {}) }
  })
}

export function parseList(stdout: string): Array<{ slug: string; title: string }> {
  const text = stdout.trim()
  if (!text) return []
  return text.split('\n').map(line => {
    const match = line.match(/^(\S+)\s{2,}(.+)$/)
    if (!match?.[1] || !match[2]) throw new KernelError('unparseable', 'Unrecognized memex list output')
    return { slug: match[1], title: match[2].trim() }
  })
}
