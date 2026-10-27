export function parseHash(hash) {
  const match = /^#(oracle|checkpoint)=(.+)$/.exec(hash);
  if (!match) return null;
  try { return { view: match[1], id: decodeURIComponent(match[2]) }; }
  catch { return null; }
}

export function filterItems(catalog, view, query = '', status = '') {
  const needle = query.trim().toLocaleLowerCase();
  const items = view === 'oracle' ? catalog.oracles : catalog.checkpoints;
  return items.filter(item => {
    if (status && (view === 'oracle' ? item.rollup : item.status) !== status) return false;
    const checkpoints = view === 'oracle'
      ? catalog.checkpoints.filter(cp => item.checkpoint_ids.includes(cp.id)) : [item];
    const ids = new Set(checkpoints.map(cp => cp.id));
    const actual = catalog.observations.filter(obs => ids.has(obs.checkpoint_id)).map(obs => obs.actual);
    const expected = view === 'checkpoint' ? catalog.oracles.filter(oracle => item.oracle_ids.includes(oracle.id)).map(oracle => oracle.expected) : [];
    return [item.id, item.title, item.description, item.expected, ...expected, ...actual].join('\n').toLocaleLowerCase().includes(needle);
  });
}

// Canonicalize JSON object keys without erasing JSON value types.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function groupObservations(observations, envKeys) {
  const loops = new Map();
  for (const observation of observations) {
    if (!loops.has(observation.loop)) loops.set(observation.loop, new Map());
    const columns = loops.get(observation.loop);
    const key = JSON.stringify(canonical(observation.env));
    if (!columns.has(key)) columns.set(key, { env: observation.env, observations: [] });
    columns.get(key).observations.push(observation);
  }
  return [...loops].sort(([a], [b]) => a - b).map(([loop, columns]) => ({
    loop, columns: [...columns.values()].sort((a, b) => JSON.stringify(envKeys.map(key => a.env[key])).localeCompare(JSON.stringify(envKeys.map(key => b.env[key]))))
      .map(column => ({ ...column, observations: [...column.observations].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || (a.obs_id ?? '').localeCompare(b.obs_id ?? '', undefined, { numeric: true })) }))
  }));
}
