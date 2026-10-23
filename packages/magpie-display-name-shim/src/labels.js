/**
 * Label lookup and adapter wrapping for dsh-magpie-display-name-shim.
 *
 * dsh-magpie-connect (0.4.1) reports `name: id` from listModels/resolveModel, so the picker shows
 * `claude/claude-haiku-5-5` although its own catalog cache already holds the gateway's
 * display_name ("Claude Haiku 5.5"). The adapter's catalog is a private field, so this module
 * reads the same cache file the plugin writes (`<dataDir>/magpie-models.json`) and replaces only
 * `name`. `id` is never touched: routing, saved selections and session history keep the route id.
 * Upstream fix: https://github.com/bitxeno/dsh-magpie-connect/pull/1 — remove this shim once a
 * release containing it is pinned.
 */
import { readFileSync, statSync } from 'node:fs';

const WRAPPED = Symbol('dsh-magpie-display-name-shim.wrapped');

/**
 * Read `{ id: displayName }` from the plugin's catalog cache, re-reading only when the file's
 * mtime changes. Any failure yields the previous map (or an empty one): labels are cosmetic, so
 * the shim never throws into the model picker.
 * @param path - absolute path of magpie-models.json.
 * @returns a function returning the current label map.
 */
export function cachedLabels(path) {
  let mtime = -1;
  let labels = new Map();
  return () => {
    try {
      const m = statSync(path).mtimeMs;
      if (m !== mtime) {
        labels = parseLabels(readFileSync(path, 'utf8'));
        mtime = m;
      }
    } catch {
      // missing/unreadable cache: keep what we had
    }
    return labels;
  };
}

/**
 * Parse the cache body. Accepts `entries` as an object keyed by id or an array of entries.
 * @param text - file contents.
 * @returns id → non-blank displayName that differs from the id.
 */
export function parseLabels(text) {
  const out = new Map();
  let data;
  try { data = JSON.parse(text); } catch { return out; }
  const entries = data?.entries;
  const rows = Array.isArray(entries) ? entries.map((e) => [e?.id, e])
    : entries && typeof entries === 'object' ? Object.entries(entries) : [];
  for (const [id, entry] of rows) {
    const label = entry?.displayName;
    if (typeof id === 'string' && typeof label === 'string' && label.trim() !== '' && label !== id) out.set(id, label);
  }
  return out;
}

/** Replace `name` with the label when one exists; everything else is returned as is. */
function relabel(model, labels) {
  if (model === null || typeof model !== 'object' || typeof model.id !== 'string') return model;
  const label = labels.get(model.id);
  return label === undefined ? model : { ...model, name: label };
}

/**
 * Wrap an adapter's listModels/resolveModel once (idempotent per instance).
 * @param adapter - the registered adapter instance.
 * @param labelsOf - returns the current id → label map.
 * @returns true when this call wrapped it.
 */
export function wrapAdapterNames(adapter, labelsOf) {
  if (adapter === null || typeof adapter !== 'object') return false;
  if (adapter[WRAPPED] === true) return false;
  let wrapped = false;
  if (typeof adapter.listModels === 'function') {
    const original = adapter.listModels;
    adapter.listModels = function listModels(...args) {
      const result = original.apply(this, args);
      if (!Array.isArray(result)) return result;
      const labels = labelsOf();
      return result.map((m) => relabel(m, labels));
    };
    wrapped = true;
  }
  if (typeof adapter.resolveModel === 'function') {
    const original = adapter.resolveModel;
    adapter.resolveModel = function resolveModel(...args) {
      return relabel(original.apply(this, args), labelsOf());
    };
    wrapped = true;
  }
  if (wrapped) Object.defineProperty(adapter, WRAPPED, { value: true });
  return wrapped;
}
