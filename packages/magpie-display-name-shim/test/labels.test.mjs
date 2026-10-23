/**
 * Pure-logic tests for dsh-magpie-display-name-shim (no DSH runtime needed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedLabels, parseLabels, wrapAdapterNames } from '../src/labels.js';

// Shape of dsh-magpie-connect 0.4.1's magpie-models.json (entries keyed by id).
const CACHE = JSON.stringify({
  updatedAt: 1,
  entries: {
    'claude/claude-haiku-5-5': { id: 'claude/claude-haiku-5-5', displayName: 'Claude Haiku 5.5' },
    'codex/gpt-6-luna': { id: 'codex/gpt-6-luna', displayName: 'GPT-6-Luna' },
    'custom/same': { id: 'custom/same', displayName: 'custom/same' },
    'custom/blank': { id: 'custom/blank', displayName: '  ' },
  },
});

/** Stand-in for MagpieAdapter 0.4.1: name is always the id. */
function fakeAdapter() {
  return {
    calls: 0,
    listModels(provider) {
      this.calls += 1;
      return ['claude/claude-haiku-5-5', 'codex/gpt-6-luna', 'custom/same', 'unknown/x']
        .map((id) => ({ provider, id, name: id, inputModalities: ['text'] }));
    },
    resolveModel(provider, model) {
      return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 1 }, defaultMaxTokens: 2 };
    },
  };
}

test('parseLabels keeps only real labels and accepts object or array entries', () => {
  const m = parseLabels(CACHE);
  assert.equal(m.get('claude/claude-haiku-5-5'), 'Claude Haiku 5.5');
  assert.equal(m.has('custom/same'), false, 'a label equal to the id adds nothing');
  assert.equal(m.has('custom/blank'), false, 'blank labels are ignored');
  const arr = parseLabels(JSON.stringify({ entries: [{ id: 'a/b', displayName: 'A B' }] }));
  assert.equal(arr.get('a/b'), 'A B');
  assert.equal(parseLabels('not json').size, 0);
  assert.equal(parseLabels('{}').size, 0);
});

test('listModels and resolveModel get the label as name; id and other fields are unchanged', () => {
  const adapter = fakeAdapter();
  const labels = parseLabels(CACHE);
  assert.equal(wrapAdapterNames(adapter, () => labels), true);
  const listed = adapter.listModels('dsh-magpie-connect');
  assert.deepEqual(listed.map((m) => m.id), ['claude/claude-haiku-5-5', 'codex/gpt-6-luna', 'custom/same', 'unknown/x']);
  assert.deepEqual(listed.map((m) => m.name), ['Claude Haiku 5.5', 'GPT-6-Luna', 'custom/same', 'unknown/x']);
  assert.deepEqual(listed[0].inputModalities, ['text']);
  const r = adapter.resolveModel('dsh-magpie-connect', 'claude/claude-haiku-5-5');
  assert.equal(r.id, 'claude/claude-haiku-5-5');
  assert.equal(r.name, 'Claude Haiku 5.5');
  assert.equal(r.defaultMaxTokens, 2);
  assert.equal(adapter.resolveModel('p', 'unknown/x').name, 'unknown/x');
});

test('wrapping is idempotent per adapter instance and keeps `this`', () => {
  const adapter = fakeAdapter();
  const labels = parseLabels(CACHE);
  assert.equal(wrapAdapterNames(adapter, () => labels), true);
  assert.equal(wrapAdapterNames(adapter, () => labels), false);
  adapter.listModels('p');
  assert.equal(adapter.calls, 1, 'original ran once, with the adapter as this');
  assert.equal(wrapAdapterNames(null, () => labels), false);
  assert.equal(wrapAdapterNames({}, () => labels), false);
});

test('cachedLabels re-reads on mtime change and survives a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-shim-'));
  try {
    const file = join(dir, 'magpie-models.json');
    const labelsOf = cachedLabels(file);
    assert.equal(labelsOf().size, 0, 'missing file -> empty, no throw');
    writeFileSync(file, CACHE);
    utimesSync(file, 1000, 1000);
    assert.equal(labelsOf().get('codex/gpt-6-luna'), 'GPT-6-Luna');
    writeFileSync(file, JSON.stringify({ entries: { 'codex/gpt-6-luna': { displayName: 'Luna' } } }));
    utimesSync(file, 2000, 2000);
    assert.equal(labelsOf().get('codex/gpt-6-luna'), 'Luna');
    rmSync(file);
    assert.equal(labelsOf().get('codex/gpt-6-luna'), 'Luna', 'keeps last good map after deletion');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('labels come from the real dsh-magpie-connect cache when present', { skip: false }, () => {
  const home = process.env.HOME ?? '';
  const labels = cachedLabels(join(home, '.dsh-magpie-connect', 'magpie-models.json'))();
  if (labels.size === 0) return; // not configured on this machine
  assert.ok([...labels.values()].every((v) => typeof v === 'string' && v.trim() !== ''));
});
