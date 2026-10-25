// Preserve the package build's flat Markdown assets without POSIX shell tools.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const source = fileURLToPath(new URL('../src/convention/', import.meta.url))
const destination = fileURLToPath(new URL('../lib/convention/', import.meta.url))
mkdirSync(destination, { recursive: true })
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md')) {
    copyFileSync(path.join(source, entry.name), path.join(destination, entry.name))
  }
}
