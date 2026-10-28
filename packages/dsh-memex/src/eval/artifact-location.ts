export interface EvidenceBackend { name: string; version: string; root: string; compression: string }
import { isAbsolute, join } from 'node:path'

/** rc.2 JSONL projectKey layout, pinned because the official helper is not exported. */
export function locateRegisteredArtifact(config: EvidenceBackend, session: { id: string; cwd: string }): { path: string; encoding: 'zstd' | 'jsonl' } {
  if (config.name !== 'session-persistence-jsonl' || config.version !== '0.2.0-rc.2' || !isAbsolute(config.root)
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
