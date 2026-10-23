/**
 * Against the real dsh-magpie-connect classes installed in the web profile (skipped when absent,
 * override with DSH_TEST_MAGPIE_LIB). Proves the bug is present in the pinned release and that
 * the shim fixes it without changing ids.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cachedLabels, wrapAdapterNames } from '../src/labels.js';

const LIB = process.env.DSH_TEST_MAGPIE_LIB
  ?? join(process.env.HOME ?? '', '.dsh/profiles/web/node_modules/dsh-magpie-connect/lib/index.js');

test('real MagpieAdapter: names are ids before, gateway labels after the shim', { skip: !existsSync(LIB) && 'dsh-magpie-connect not installed' }, async () => {
  const { MagpieAdapter, ModelCatalog } = await import(pathToFileURL(LIB).href);
  const catalog = new ModelCatalog({ baseUrl: 'http://test.lan/v1', apiKey: 'k' });
  catalog.adoptDirectory(new Map([
    ['claude/claude-haiku-5-5', { id: 'claude/claude-haiku-5-5', displayName: 'Claude Haiku 5.5', image: true, nativeEndpoints: ['/v1/chat/completions'], reasoning: false }],
  ]));
  const adapter = new MagpieAdapter(catalog, { magpieBaseUrl: 'http://test.lan' });
  const before = adapter.listModels('dsh-magpie-connect').find((m) => m.id === 'claude/claude-haiku-5-5');
  // When this flips (upstream PR merged and pinned), the shim is redundant: retire it.
  assert.equal(before?.name, 'claude/claude-haiku-5-5', 'pinned release still reports name: id');

  const dir = mkdtempSync(join(tmpdir(), 'magpie-real-'));
  try {
    const file = join(dir, 'magpie-models.json');
    writeFileSync(file, JSON.stringify({ entries: { 'claude/claude-haiku-5-5': { displayName: 'Claude Haiku 5.5' } } }));
    assert.equal(wrapAdapterNames(adapter, cachedLabels(file)), true);
    const after = adapter.listModels('dsh-magpie-connect').find((m) => m.id === 'claude/claude-haiku-5-5');
    assert.equal(after?.name, 'Claude Haiku 5.5');
    const resolved = adapter.resolveModel('dsh-magpie-connect', 'claude/claude-haiku-5-5');
    assert.equal(resolved.id, 'claude/claude-haiku-5-5');
    assert.equal(resolved.name, 'Claude Haiku 5.5');
    assert.ok(resolved.context.contextWindow > 0, 'other resolveModel fields intact');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
