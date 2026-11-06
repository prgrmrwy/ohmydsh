export interface EvidenceBackend { name: string; version: string; root: string; compression: string }
import { isAbsolute, join } from 'node:path'

/**
 * Audited JSONL backend versions whose projectKey layout and `session.v4` file naming
 * match this copy (the official helper is not exported). 0.2.1-rc.5 was re-read on
 * 2026-11-05 (dsh-session-persistence-jsonl lib/index.js projectKey/sessionDir/logPath,
 * SESSION_FORMAT_VERSION 4). Any other version is refused rather than guessed.
 *
 * 0.2.2-rc.1 was re-read on 2026-11-07 against the installed release (all line numbers are
 * node_modules/@deepseek-ai/*): dsh-session-persistence-jsonl/lib/index.js projectKey :880-899
 * (unchanged `--<readable>--` layout, `~XXXX` escapes, 251-char cap), encodeSegment :858 (identity
 * for the `session-[A-Za-z0-9-]+` ids admitted below), sessionDir :919, generationLogFilename :766
 * (`session.v4.jsonl` + `.zstd` for zstd) via dsh-session-format/lib/index.js sessionFormatLogFilename :472,
 * and dsh-session/lib/index.js SESSION_FORMAT_VERSION = 4 :56. Re-audit these before adding any later version.
 */
const AUDITED_JSONL_VERSIONS: ReadonlySet<string> = new Set(['0.2.0-rc.2', '0.2.1-rc.5', '0.2.2-rc.1'])

/** Pinned JSONL projectKey layout. */
export function locateRegisteredArtifact(config: EvidenceBackend, session: { id: string; cwd: string }): { path: string; encoding: 'zstd' | 'jsonl' } {
  if (config.name !== 'session-persistence-jsonl' || !AUDITED_JSONL_VERSIONS.has(config.version) || !isAbsolute(config.root)
    || !['zstd', 'none'].includes(config.compression) || !isAbsolute(session.cwd) || !/^session-[A-Za-z0-9-]+$/.test(session.id)) throw new Error('Unsupported evidence backend or registered metadata')
  let readable = '', separator = false
  for (let i = 0; i < session.cwd.length; i++) {
    const ch = session.cwd[i]!
    if (ch === '/' || ch === '\\' || ch === ':') { if (!separator) readable += '-'; separator = true }
    else {
      readable += ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch) ? ch : '~' + session.cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
      separator = false
    }
  }
  const project = `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
  return { path: join(config.root, project, session.id, config.compression === 'zstd' ? 'session.v4.jsonl.zstd' : 'session.v4.jsonl'), encoding: config.compression === 'zstd' ? 'zstd' : 'jsonl' }
}
