import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { durableWrite, readRegular } from './freeze.js'

/** Persists a warning, never owns a Host model write capability. */
export class DefaultModelNotice {
  constructor(private readonly directory: string) {}
  begin(selection: unknown): void {
    durableWrite(join(this.directory, 'default-before.json'), JSON.stringify({ selection }) + '\n')
  }
  pending(): boolean {
    return existsSync(join(this.directory, 'default-before.json')) && !existsSync(join(this.directory, 'default-confirmed'))
  }
  describe(current: unknown): string {
    if (!this.pending()) return ''
    const before = JSON.parse(readFileSync(join(this.directory, 'default-before.json'), 'utf8')) as { selection: unknown }
    return `运行前默认值：${JSON.stringify(before.selection)}；当前默认值：${JSON.stringify(current)}。selectModel 可能异步更改默认值，无法判断写入者；请手动检查并按需恢复，再明确确认。工具不会自动写回。`
  }
  describeOffline(): string {
    let raw: Buffer
    try { raw = readRegular(join(this.directory, 'default-before.json')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
    const before = JSON.parse(raw.toString()) as Record<string, unknown>
    if (!before || typeof before !== 'object' || Array.isArray(before) || Object.keys(before).length !== 1 || !Object.hasOwn(before, 'selection')) throw new Error('Invalid default model notice')
    let confirmed = false
    try {
      const marker = readRegular(join(this.directory, 'default-confirmed')).toString()
      if (marker !== 'User confirmed manual review\n') throw new Error('Invalid default confirmation record')
      confirmed = true
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return `运行前默认值：${JSON.stringify(before.selection)}；当前默认值：unknown（离线未读取 Host）。${confirmed ? '已记录人工确认；不证明当前默认值已恢复' : '尚待人工检查并按需恢复'}。工具不会自动写回。`
  }
  confirm(): void {
    if (this.pending()) durableWrite(join(this.directory, 'default-confirmed'), 'User confirmed manual review\n')
  }
}
