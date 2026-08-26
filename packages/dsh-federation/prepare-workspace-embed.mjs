#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorkspaceEmbed } from '../../scripts/build-rc2-workspace-embed.mjs'

const PACKAGE = path.dirname(fileURLToPath(import.meta.url))
export const WORKSPACE_EMBED_DIR = path.join(PACKAGE, '.generated/workspace-embed')

export function prepareWorkspaceEmbed() {
  return buildWorkspaceEmbed({ outputDir: WORKSPACE_EMBED_DIR })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareWorkspaceEmbed().then(result => {
    process.stdout.write(`[dsh-federation] workspace embed ${result.reused ? 'reused' : 'rebuilt'} ${result.patchSha256}\n`)
  }).catch(error => {
    console.error(`[dsh-federation] workspace embed failed: ${error.message}`)
    process.exitCode = 1
  })
}
