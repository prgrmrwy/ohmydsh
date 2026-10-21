import { promises as nodeFs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
// Same line codec as FileStore loading; relative source import is inlined at build.
// Keep in sync with packages/collab-kernel/src/store/canonical.ts.
import { decodeRecord } from '../../collab-kernel/src/store/canonical.js'

const SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export type SalvageFs = Pick<typeof nodeFs, 'open' | 'readFile' | 'link' | 'rename' | 'unlink' | 'stat' | 'realpath'>
export interface SalvageDeps { fs?: Partial<SalvageFs>; pid?: number; now?: () => Date; killedBy?: unknown }

/**
 * Line-by-line validation with FileStore's rules: only newline-terminated
 * bytes count, each line must decode as fatal UTF-8, verify its checksum and
 * continue the seq. Splitting at 0x0a is safe because UTF-8 continuation
 * bytes never equal 0x0a, so this matches FileStore's whole-buffer decode.
 */
export function scanLog(raw: Buffer): { kept: number; keptBytes: number; firstBadLine?: number } {
  const complete = raw.lastIndexOf(0x0a) + 1
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let offset = 0, kept = 0
  while (offset < complete) {
    const end = raw.indexOf(0x0a, offset)
    try {
      const record = decodeRecord(decoder.decode(raw.subarray(offset, end)))
      if (!Number.isSafeInteger(record.seq) || record.seq !== kept + 1) throw new Error('seq')
    } catch { return { kept, keptBytes: offset, firstBadLine: kept + 1 } }
    kept++; offset = end + 1
  }
  return { kept, keptBytes: offset }
}

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/** Offline repair of a corrupt ledger. The Host MUST be stopped. Never deletes the original bytes. */
export async function salvage(options: { dataDir: string; spaceId: string }, deps: SalvageDeps = {}): Promise<{ code: number; lines: string[] }> {
  const fs: SalvageFs = { ...nodeFs, ...deps.fs } as SalvageFs
  const out: string[] = []
  const refuse = (...lines: string[]) => ({ code: 1, lines: [...out, ...lines] })
  if (!isAbsolute(options.dataDir) || !SPACE_ID.test(options.spaceId) || options.spaceId === '.' || options.spaceId === '..') return refuse('拒绝：--data-dir 必须是绝对路径，--space-id 必须是合法空间 ID。')
  const root = await fs.realpath(options.dataDir)
  const id = options.spaceId, log = join(root, `${id}.jsonl`), lockPath = join(root, `${id}.lock`), tmp = join(root, `${id}.jsonl.salvage-tmp`)
  const present = (path: string) => fs.stat(path).then(() => true, () => false)
  const syncDir = async () => { const dir = await fs.open(root, 'r'); try { await dir.sync() } finally { await dir.close() } }
  // ① exclusive lock with a normal {instanceId, pid}; an existing lock means the space is held.
  const instanceId = `salvage-${randomUUID()}`
  try {
    const handle = await fs.open(lockPath, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ instanceId, pid: deps.pid ?? process.pid })); await handle.sync() } finally { await handle.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return refuse(`拒绝：${id}.lock 已存在，空间可能仍被 Host 持有。请先停止 Host；残留锁由下一次 Host 启动按死亡证明清理。`)
    return refuse(`拒绝：无法创建 ${id}.lock。`)
  }
  const release = async () => {
    try { if (JSON.parse(await fs.readFile(lockPath, 'utf8') as string).instanceId === instanceId) await fs.unlink(lockPath) } catch {}
  }
  try {
    if (await present(tmp)) {
      const backups = (await nodeFs.readdir(root)).filter(name => name.startsWith(`${id}.jsonl.corrupt-`))
      await release()
      return refuse(
        '拒绝：上次抢救可能中断。当前状态：',
        `- ${id}.jsonl.salvage-tmp：存在`,
        `- 备份 ${id}.jsonl.corrupt-*：${backups.length ? `存在（${backups.join(', ')}）` : '不存在'}`,
        `- 日志 ${id}.jsonl：${await present(log) ? '存在' : '不存在'}`,
        `唯一允许的人工动作：确认 ${id}.jsonl 为原损坏文件后删除 ${id}.jsonl.salvage-tmp，再重跑本命令。`,
      )
    }
    let raw: Buffer
    try { raw = await fs.readFile(log) as Buffer } catch { await release(); return refuse(`拒绝：${id}.jsonl 不存在或不可读。`) }
    // ② the longest valid contiguous prefix before the first bad line.
    const scan = scanLog(raw)
    if (scan.firstBadLine === undefined) { await release(); return { code: 0, lines: [`${id}.jsonl 未发现损坏行（${scan.kept} 条记录），未做任何修改。`] } }
    // ③ write the prefix (original bytes) to tmp and fsync.
    if (scan.kept > 0) {
      try {
        const handle = await fs.open(tmp, 'wx', 0o600)
        try { await handle.writeFile(raw.subarray(0, scan.keptBytes)); await handle.sync() } finally { await handle.close() }
      } catch {
        await fs.unlink(tmp).catch(() => {}); await release()
        return refuse('失败：写入临时文件失败，原日志未改动。')
      }
    }
    // ④ hard-link backup, never overwriting an existing file; fsync the directory.
    let backup = ''
    try {
      const base = `${id}.jsonl.corrupt-${stamp((deps.now ?? (() => new Date()))())}`
      for (let n = 0; ; n++) {
        backup = n ? `${base}-${n}` : base
        try { await fs.link(log, join(root, backup)); break }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || n >= 99) throw error }
      }
      await syncDir()
    } catch {
      await release()
      return refuse(`失败：创建硬链接备份失败，原日志未改动${scan.kept > 0 ? `，临时文件 ${id}.jsonl.salvage-tmp 保留` : ''}。`)
    }
    // ⑤ atomic replacement, or removal when nothing valid remains; fsync the directory.
    try {
      if (scan.kept > 0) await fs.rename(tmp, log)
      else { await fs.unlink(log); await fs.unlink(tmp).catch(() => {}) }
      await syncDir()
    } catch (error) {
      if (deps.killedBy !== undefined && error === deps.killedBy) return { code: 137, lines: [...out, '（测试：模拟进程在 ④ 与 ⑤ 之间被终止）'] }
      await release()
      return refuse(`失败：替换日志失败。${id}.jsonl 仍为原损坏字节，备份 ${backup} 已建立；Host 启动后该空间仍不可用。`)
    }
    // ⑥ release our own lock.
    await release()
    return { code: 0, lines: [
      `已抢救 ${id}：保留 ${scan.kept} 条记录；首个坏行为第 ${scan.firstBadLine} 行。原文件备份为 ${backup}。`,
      ...(scan.kept === 0 ? [`没有合法记录，${id}.jsonl 已删除，可以用原 spaceId 重新创建。`] : []),
      '被丢弃命令的收据已丢失：对这些 cmdId 的重试会被当作新命令执行。',
      '此后的 seq 会被复用，成员须把读取游标重置为 0；有 agent 参与时建议改用新 spaceId。',
    ] }
  } catch (error) { await release(); throw error }
}
