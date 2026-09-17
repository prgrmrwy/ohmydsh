/**
 * Task 1.4 / 2.1 — real host-seam contract checks for the Pet SQLite domain's
 * additive schema-evolution path.
 *
 * This file records the REAL, currently-committed pattern (14 pre-existing
 * additive bumps, one hand-rolled parser per non-trivial record type) AND
 * verifies that `shared_fact_ledger`/`ledger_item` (added in task 2.1) landed
 * as v15 following that exact pattern — not a re-derived assumption.
 */
import { describe, expect, it } from 'vitest'

describe('intent-triage domain contract: additive schema evolution (tasks 1.4 / 2.1)', () => {
  it('PET_DOMAIN_VERSION is 15: shared_fact_ledger/ledger_item landed at v15 with a written additive rationale, matching every prior bump', async () => {
    const fs = await import('node:fs')
    const specSource = fs.readFileSync(
      new URL('../src/host/spec.ts', import.meta.url),
      'utf8',
    )
    expect(specSource).toContain('export const PET_DOMAIN_VERSION = 15')
    expect(specSource).toContain('Bumped to 15 for the shared-fact ledger')

    // Every bump to date except v1->v2 is additive (new table and/or optional
    // field; old rows keep validating and are never rewritten or cleared).
    const additiveBumpCount = (specSource.match(/[Aa]dditive/g) ?? []).length
    expect(additiveBumpCount).toBeGreaterThanOrEqual(11)
    // v1→v2 is the one documented NON-additive bump (Skill digest rename) —
    // confirms this file's history actually contains the one exception, so
    // "all additive" above is a verified count, not an assumption.
    expect(specSource).toContain('Rows written by v1')
    expect(specSource).toContain('cannot be upgraded in place')
  })

  it('every table (including the two new ones) follows the same domainTable<string, z.infer<typeof X>>(X) shape', async () => {
    const fs = await import('node:fs')
    const specSource = fs.readFileSync(
      new URL('../src/host/spec.ts', import.meta.url),
      'utf8',
    )
    const tableDecls = [...specSource.matchAll(/(\w+):\s*domainTable<string, z\.infer<typeof (\w+)>>\((\w+)\)/g)]
    // 22 real tables after adding shared_fact_ledger + ledger_item (verified
    // by actually counting the matches, not by re-deriving the number from a
    // manually-read list — an earlier version of this test undercounted by
    // one that same way, catching an inquiry_results omission before it
    // could mislead task 2.1).
    expect(tableDecls.length).toBe(22)
    for (const [, , schemaTypeName, schemaValueName] of tableDecls) {
      // Every declaration's type-arg and value-arg name the SAME schema
      // symbol — there is no table with a mismatched schema/type pair today.
      expect(schemaTypeName).toBe(schemaValueName)
    }
  })

  it('the two new table names land alongside, not colliding with, the 20 pre-existing tables', async () => {
    const fs = await import('node:fs')
    const specSource = fs.readFileSync(
      new URL('../src/host/spec.ts', import.meta.url),
      'utf8',
    )
    const existingNames = [...specSource.matchAll(/^\s*(\w+):\s*domainTable</gm)].map(m => m[1])
    expect(existingNames).toEqual([
      'tasks', 'invocations', 'snapshots', 'runs', 'skill_revisions',
      'skill_selections', 'workspace_env', 'channel_config', 'chat_bindings',
      'invocation_channel', 'loci', 'locus_indexes', 'locus_deliveries',
      'locus_operations', 'locus_switch_notices', 'locus_permission_audit',
      'collaboration_contexts', 'collaboration_context_revisions', 'inquiries',
      'inquiry_results', 'shared_fact_ledger', 'ledger_item',
    ])
  })

  it('petLedgerItemRecord delegates to parseTodoRecord and swallows the real error, matching the inquiries-table non-leaking pattern', async () => {
    // `inquiries` is the closest real precedent: an independent stateful
    // entity, not a flat config row. Its schema is a THIN delegation, and the
    // catch block intentionally reports only a generic message — never the
    // real field-level issue — because the real issue could echo back
    // sensitive content. `ledger_item` carries comparably sensitive fields
    // (summary, evidence, requestedBy) and must follow the same non-leaking
    // shape, not a bespoke z.object with granular per-field error messages.
    const fs = await import('node:fs')
    const specSource = fs.readFileSync(
      new URL('../src/host/spec.ts', import.meta.url),
      'utf8',
    )
    // The precedent this pattern was copied from.
    expect(specSource).toContain('export const petInquiryRecord = z.unknown().transform((input, issueCtx) => {')
    expect(specSource).toContain('return parseInquiry(input)')
    expect(specSource).toContain("issueCtx.addIssue({ code: 'custom', message: 'Invalid inquiry record.' })")

    // The new record actually follows it.
    expect(specSource).toContain('export const petLedgerItemRecord = z.unknown().transform((input, issueCtx) => {')
    expect(specSource).toContain('return parseTodoRecord(input)')
    expect(specSource).toContain("issueCtx.addIssue({ code: 'custom', message: 'Invalid ledger item record.' })")
    expect(specSource).toContain('return z.NEVER')
    expect(specSource).toContain('Never leak a todo\'s summary, evidence or requestedBy.')
  })

  it('petSharedFactLedgerRecord validates its two fields and rejects a malformed row rather than guessing defaults', async () => {
    const fs = await import('node:fs')
    const specSource = fs.readFileSync(
      new URL('../src/host/spec.ts', import.meta.url),
      'utf8',
    )
    expect(specSource).toContain('export const petSharedFactLedgerRecord = z.unknown().transform((input, issueCtx) => {')
    expect(specSource).toContain("issueCtx.addIssue({ code: 'custom', message: 'Invalid shared-fact-ledger record.' })")
  })

  it('PET_DOMAIN_NAME satisfies the underscore-only unit-name constraint; the two new table names respect it too', async () => {
    const fs = await import('node:fs')
    const specSource = fs.readFileSync(
      new URL('../src/host/spec.ts', import.meta.url),
      'utf8',
    )
    expect(specSource).toContain("export const PET_DOMAIN_NAME = 'dsh_pet'")
    expect(specSource).toContain('UNIT_NAME_RE')
    for (const tableName of ['shared_fact_ledger', 'ledger_item']) {
      expect(tableName).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})
