import { stat as fsStat } from 'node:fs/promises'

export function watchCatalogInvalidation(input: { configPath: string; invalidate: () => void; stat?: (path: string) => Promise<{ mtimeMs: number; size: number }>; intervalMs?: number }) {
  const readStat = input.stat ?? (async path => fsStat(path))
  let prior: string | undefined
  let disposed = false
  let running: Promise<void> | undefined
  const check = async () => {
    if (disposed) return
    if (running) return running
    running = (async () => {
      let signature: string
      try { const result = await readStat(input.configPath); signature = `${result.mtimeMs}:${result.size}` }
      catch { signature = 'missing' }
      if (prior !== undefined && signature !== prior) input.invalidate()
      prior = signature
    })()
    try { await running } finally { running = undefined }
  }
  const timer = setInterval(() => { void check() }, input.intervalMs ?? 30_000)
  timer.unref?.()
  return { check, dispose() { disposed = true; clearInterval(timer) } }
}
