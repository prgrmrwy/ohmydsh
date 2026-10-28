import type { ReleaseEvent } from './release.js'
import { sessionHash } from '../telemetry/snapshot.js'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface LedgerEvent {
  readonly kind: 'reserved' | 'created' | 'child' | 'job'
  readonly id: string
  readonly parent?: string
  readonly round?: string
  readonly question?: string
  readonly condition?: string
}

export class EvalLedger {
  private readonly creating = new Map<string, Promise<string>>()
  constructor(readonly directory: string, readonly registryFile?: string) {}

  reserve(round: string, question: string, condition: string): string {
    const id = `session-${randomUUID()}`
    this.append({ kind: 'reserved', id, round, question, condition })
    return id
  }

  read(): LedgerEvent[] {
    let bytes: string
    try { bytes = readFileSync(join(this.directory, 'ledger.ndjson'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    return bytes.split('\n').filter(Boolean).map(line => {
      const value = JSON.parse(line) as LedgerEvent
      if (!['reserved', 'created', 'child', 'job'].includes(value.kind) || typeof value.id !== 'string' || !value.id) throw new Error('Invalid identity ledger')
      return value
    })
  }

  recordRelease(event: ReleaseEvent): void {
    const fd = openSync(join(this.directory, 'jobs.ndjson'), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid job ledger file')
      writeFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd)
    } finally { closeSync(fd) }
  }

  releaseHistory(generation: string): ReleaseEvent[] {
    let bytes: string
    try { bytes = readFileSync(join(this.directory, 'jobs.ndjson'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    return bytes.split('\n').filter(Boolean).map(line => {
      const event = JSON.parse(line) as ReleaseEvent
      if (event.generation !== generation) throw new Error('Host generation mismatch; resource recovery unproven')
      if (!['registered', 'settled', 'removed'].includes(event.type) || typeof event.id !== 'string' || typeof event.owner !== 'string') throw new Error('Invalid job release evidence')
      return event
    })
  }

  recordCreated(id: string): void {
    const events = this.read()
    if (!events.some(e => e.kind === 'reserved' && e.id === id)) throw new Error('Unreserved session identity')
    if (!events.some(e => e.kind === 'created' && e.id === id)) {
      const reserved = events.find(e => e.kind === 'reserved' && e.id === id)!
      this.append({ ...reserved, kind: 'created' })
    }
  }

  recordJob(parent: string, id: string): void { this.append({ kind: 'job', parent, id }) }
  recordChild(parent: string, id: string): void { this.append({ kind: 'child', parent, id }) }

  async ensureCreated(id: string, port: { lookup(id: string): Promise<string | undefined>; create(id: string): Promise<string> }): Promise<string> {
    const inFlight = this.creating.get(id)
    if (inFlight) return inFlight
    const operation = this.createOnce(id, port)
    this.creating.set(id, operation)
    try { return await operation } finally { this.creating.delete(id) }
  }

  private async createOnce(id: string, port: { lookup(id: string): Promise<string | undefined>; create(id: string): Promise<string> }): Promise<string> {
    if (!this.read().some(e => e.kind === 'reserved' && e.id === id)) throw new Error('Unreserved session identity')
    const existing = await port.lookup(id)
    const actual = existing ?? await port.create(id)
    if (actual !== id) throw new Error('Created session identity mismatch')
    this.recordCreated(id)
    return actual
  }

  async requireSettled(port: { settle(event: LedgerEvent): Promise<boolean> }): Promise<void> {
    const events = this.read()
    const resources = new Map<string, LedgerEvent>()
    for (const event of events) resources.set(`${event.kind === 'job' ? 'job' : 'session'}:${event.id}`, event)
    const pending: string[] = []
    for (const event of [...resources.values()].reverse()) {
      try { if (!await port.settle(event)) pending.push(event.id) }
      catch { pending.push(event.id) }
    }
    if (pending.length) throw new Error(`Resources not settled: ${pending.join(', ')}`)
  }

  private append(event: LedgerEvent): void {
    const fd = openSync(join(this.directory, 'ledger.ndjson'), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid identity ledger file')
      writeFileSync(fd, JSON.stringify(event) + '\n')
      fsyncSync(fd)
    } finally { closeSync(fd) }
    if (this.registryFile && event.kind !== 'job') {
      const events = this.read()
      let owner: LedgerEvent | undefined = event
      const visited = new Set<string>()
      while (owner?.parent !== undefined) {
        if (visited.has(owner.id)) throw new Error('Identity lineage cycle')
        visited.add(owner.id)
        const parent: string = owner.parent
        owner = events.find(e => e.id === parent)
      }
      const record = { round: owner?.round, role: event.kind, sessionHash: sessionHash(event.id), ...(event.parent ? { parentHash: sessionHash(event.parent) } : {}) }
      const registry = openSync(this.registryFile, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
      try {
        const stat = fstatSync(registry)
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid public eval registry')
        writeFileSync(registry, JSON.stringify(record) + '\n'); fsyncSync(registry)
      } finally { closeSync(registry) }
    }
  }
}
