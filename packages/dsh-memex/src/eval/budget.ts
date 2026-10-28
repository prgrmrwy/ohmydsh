import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { durableWrite } from './freeze.js'

/** Exclusive durable slots count actual admitted requests, including uncertain outcomes. */
export function persistentJudgeBudget(directory: string, maximum: number): { claim(): void; used(): number } {
  if (maximum !== 12) throw new Error('Fixed judge budget must be twelve')
  const used = () => {
    let count = 0, gap = false
    for (let index = 0; index < maximum; index++) {
      let stat
      try { stat = lstatSync(join(directory, `judge-call-${index}`)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (!stat) { gap = true; continue }
      if (gap || !stat.isFile() || stat.nlink !== 1) throw new Error('Invalid judge budget evidence')
      count++
    }
    return count
  }
  return { used, claim() {
    const index = used()
    if (index >= maximum) throw new Error('Judge call budget exhausted')
    durableWrite(join(directory, `judge-call-${index}`), 'Request admitted; never refund uncertain outcome\n')
  } }
}
export function judgeBudget(maximum: number): { claim(): void; used(): number } {
  if (maximum !== 12) throw new Error('Fixed judge budget must be twelve')
  let used = 0
  return { claim() { if (used >= maximum) throw new Error('Judge call budget exhausted'); used++ }, used: () => used }
}
