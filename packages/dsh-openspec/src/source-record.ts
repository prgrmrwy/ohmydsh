import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** The checkout recorded by `scripts/sync.mjs`; absent, malformed or relative records yield undefined (upgrade stays blocked). */
export async function readSourceCheckout(stateDir: string): Promise<string | undefined> {
  try {
    const record = JSON.parse(await readFile(join(stateDir, 'source-checkout.json'), 'utf8'))
    return record?.schemaVersion === 1 && typeof record.checkout === 'string' && isAbsolute(record.checkout) ? record.checkout : undefined
  } catch { return undefined }
}

/** A Git worktree checkout has a `.git` file (not a directory); such a checkout is never an authoritative upgrade target. */
export async function isWorktreeCheckout(checkout: string): Promise<boolean> {
  try { return (await stat(join(checkout, '.git'))).isFile() } catch { return true }
}
