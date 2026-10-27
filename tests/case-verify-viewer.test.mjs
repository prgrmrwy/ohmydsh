import test from 'node:test';
import assert from 'node:assert/strict';
import { mount } from '../skills/case-verify/viewer/app.js';
import { parseHash, filterItems, groupObservations } from '../skills/case-verify/viewer/logic.js';

// Only the DOM operations used by production rendering; HTML parsing is deliberately absent.
class Node {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.value = ''; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, fn) { (this.events[type] ??= []).push(fn); }
  dispatchEvent(event) { for (const fn of this.events[event.type] ?? []) fn(event); }
  focus() { this.focused = true; }
  querySelector(selector) { return walk(this).find(node => selector.startsWith('#') ? node.id === selector.slice(1) : node.tagName === selector) ?? null; }
}
function walk(node) { return node.children.flatMap(child => [child, ...walk(child)]); }
class Document extends Node {
  constructor(hash = '') {
    super('document'); this.body = new Node('body'); this.append(this.body);
    this.defaultView = new Node('window'); this.defaultView.location = { hash };
  }
  createElement(tag) { return new Node(tag); }
}
const screenshot = { name: 'after.png', kind: 'screenshot', scope: 'exact', url: '/asset/0123456789abcdef01234567' };
function fixture() {
  return { schema: 1, title: 'Synthetic save verification', generated_at: '2026-10-27T12:00:00Z', env_keys: ['role', 'shape'],
    oracles: [
      { id: 'O-1', title: 'Save state', expected: 'Saved value persists', checkpoint_ids: ['C1'], rollup: 'pass' },
      { id: 'O-2', title: 'Unmapped', expected: 'Other requirement', checkpoint_ids: [], rollup: 'uncovered' }],
    checkpoints: [
      { id: 'C1', trail_id: 'T1', trail_name: 'Save trail', description: 'Save result', origin: 'oracle', oracle_ids: ['O-1'], status: 'pass', observation_ids: ['obs-1', 'obs-2', 'obs-3'] },
      { id: 'C2', trail_id: 'T1', trail_name: 'Save trail', description: 'Exploration', origin: 'derived', oracle_ids: ['O-2'], status: 'pending', observation_ids: ['obs-4'] }],
    observations: [
      { obs_id: 'obs-1', checkpoint_id: 'C1', loop: 1, batch: 'B1', env: { role: 'member', shape: 'wide' }, status: 'fail', actual: 'Wrong value', limits: [], plan_rev: 1, expired: false, superseded_by: 'obs-2', evidence: [] },
      { obs_id: 'obs-2', checkpoint_id: 'C1', loop: 1, batch: 'B1', env: { role: 'member', shape: 'wide' }, status: 'pass', actual: 'Persisted safely', plan_rev: 1, expired: false, supersedes: 'obs-1', at: '2026-10-27T11:00:00Z', evidence: [screenshot] },
      { obs_id: 'obs-3', checkpoint_id: 'C1', loop: 1, batch: 'B2', env: { role: 'admin', shape: 'narrow' }, status: 'pass', actual: 'Admin save', expired: false, evidence: [{ name: 'network.json', kind: 'network', scope: 'exact', unavailable: true }] },
      { obs_id: 'obs-4', checkpoint_id: 'C2', loop: 2, env: {}, status: 'fail', actual: 'Historical derived fail', expired: true, evidence: [] }],
    gaps: { uncovered_oracles: ['O-2'], derived_checkpoints: ['C2'] } };
}
const click = node => node.dispatchEvent({ type: 'click', preventDefault() {} });
function start(hash = '', catalog = fixture()) { const document = new Document(hash); mount(document, catalog); return document; }

test('test_deeplink_checkpoint', () => {
  const doc = start('#checkpoint=C1'); const detail = doc.querySelector('#detail');
  assert.match(detail.textContent, /C1/); assert.match(detail.textContent, /obs-1/);
  assert.match(detail.textContent, /已被 obs-2 纠偏/); assert.match(detail.textContent, /obs-2/);
});
test('test_history_expired_on_reconfirm', () => {
  const catalog = fixture(); catalog.oracles[0].rollup = 'partial';
  for (const cp of catalog.checkpoints) cp.status = 'pending';
  for (const obs of catalog.observations) obs.expired = true;
  for (const hash of ['#oracle=O-1', '#checkpoint=C1', '#checkpoint=C2']) {
    const doc = start(hash, catalog); const text = doc.querySelector('#detail').textContent;
    assert.match(text, /已过期，不计入当前状态/);
    assert.match(text, hash.includes('oracle') ? /partial/ : /pending/);
    assert.match(text, /fail/); // Historical status is never overwritten with pending.
  }
});
test('test_render_literal_html', () => {
  const catalog = fixture(); catalog.oracles[0].expected = '<img src=x onerror=alert(1)>';
  catalog.oracles[0].title = '<script>alert(2)</script>';
  catalog.observations[0].actual = '<svg onload=alert(3)>';
  const detail = start('#oracle=O-1', catalog).querySelector('#detail');
  assert.equal(detail.querySelector('#expected').textContent, catalog.oracles[0].expected);
  assert.match(detail.textContent, /<svg onload=alert\(3\)>/);
  assert.equal(detail.querySelector('img'), null); assert.equal(detail.querySelector('script'), null);
});
test('test_unknown_deeplink', () => {
  assert.match(start('#oracle=NOPE').querySelector('#detail').textContent, /未找到 NOPE/);
});
test('search_filter_pure_and_DOM', () => {
  const catalog = fixture();
  for (const query of ['O-1', 'Save state', 'Saved value', 'Persisted safely']) {
    assert.deepEqual(filterItems(catalog, 'oracle', query, '').map(item => item.id), ['O-1']);
  }
  assert.deepEqual(filterItems(catalog, 'checkpoint', 'Admin save', 'pass').map(item => item.id), ['C1']);
  assert.deepEqual(filterItems(catalog, 'checkpoint', 'Saved value', '').map(item => item.id), ['C1']);
  assert.equal(filterItems(catalog, 'oracle', '', 'uncovered')[0].id, 'O-2');
  const doc = start(); const search = doc.querySelector('#search'); search.value = 'Unmapped'; search.dispatchEvent({ type: 'input' });
  assert.match(doc.querySelector('#items').textContent, /O-2/); assert.doesNotMatch(doc.querySelector('#items').textContent, /O-1/);
  const status = doc.querySelector('#status-filter'); status.value = 'pass'; status.dispatchEvent({ type: 'change' });
  assert.match(doc.querySelector('#items').textContent, /没有匹配/);
});
test('perspective_switch_crosslinks_and_hashchange', () => {
  const doc = start('#checkpoint=C1'); click(doc.querySelector('#oracle-link-O-1'));
  assert.equal(doc.defaultView.location.hash, '#oracle=O-1');
  assert.match(doc.querySelector('#detail').textContent, /查看器计算值，不是验收结论/);
  click(doc.querySelector('#view-checkpoint')); assert.match(doc.querySelector('#detail').textContent, /C1/);
  doc.defaultView.location.hash = '#oracle=O-2'; doc.defaultView.dispatchEvent({ type: 'hashchange' });
  assert.match(doc.querySelector('#detail').textContent, /未覆盖/);
  doc.defaultView.location.hash = '#checkpoint=C2'; doc.defaultView.dispatchEvent({ type: 'hashchange' });
  assert.match(doc.querySelector('#detail').textContent, /derived/);
});
test('loop_env_grouping_preserves_type_and_key_order', () => {
  const observations = fixture().observations;
  const groups = groupObservations([...observations].reverse(), ['role', 'shape']);
  assert.deepEqual(groups.map(group => group.loop), [1, 2]);
  assert.equal(groups[0].columns.length, 2);
  assert.deepEqual(groups[0].columns.find(column => column.env.role === 'member').observations.map(obs => obs.obs_id), ['obs-1', 'obs-2']);
  assert.equal(groupObservations([{ loop: 1, env: { role: true } }, { loop: 1, env: { role: 1 } }], ['role'])[0].columns.length, 2);
  const doc = start('#checkpoint=C1'); const detail = doc.querySelector('#detail');
  assert.match(detail.textContent, /Loop 1/); assert.match(detail.textContent, /role: member/); assert.match(detail.textContent, /shape: narrow/);
});
test('lightbox_escape_close_and_unavailable_evidence', () => {
  const doc = start('#checkpoint=C1'); const button = doc.querySelector('#evidence-obs-2-0');
  assert.ok(button); click(button); const lightbox = doc.querySelector('#lightbox');
  assert.equal(lightbox.hidden, false); assert.equal(lightbox.querySelector('img').src, screenshot.url);
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' }); assert.equal(lightbox.hidden, true); assert.equal(button.focused, true);
  click(button); click(doc.querySelector('#lightbox-close')); assert.equal(lightbox.hidden, true);
  assert.match(doc.querySelector('#detail').textContent, /network.json.*不可用/);
  assert.equal(doc.querySelector('#evidence-obs-3-0'), null);
});
test('snapshot_timestamp_and_hash_parser', () => {
  assert.match(start().textContent, /2026-10-27T12:00:00Z/); assert.match(start().textContent, /重启 view/);
  assert.deepEqual(parseHash('#oracle=O%20one'), { view: 'oracle', id: 'O one' });
  assert.equal(parseHash('#oracle=%ZZ'), null); assert.equal(parseHash('#other=C1'), null);
  assert.deepEqual(parseHash('#checkpoint=C1'), { view: 'checkpoint', id: 'C1' });
});
