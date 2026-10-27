import { parseHash, filterItems, groupObservations } from './logic.js';

const display = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function mount(document, catalog) {
  const window = document.defaultView;
  const el = (tag, text, className, id) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = display(text);
    if (className) node.className = className;
    if (id) node.id = id;
    return node;
  };
  const button = (text, id, action) => {
    const node = el('button', text, '', id); node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const badge = status => el('span', status === 'uncovered' ? '未覆盖 (uncovered)' : status, `status status-${status}`);
  const header = el('header', null, 'page-header');
  header.append(el('h1', catalog.title || 'Evidence viewer'), el('p', `只读快照 ${catalog.generated_at}。重启 view 以刷新。`, 'snapshot'));
  const workspace = el('main', null, 'workspace');
  const sidebar = el('aside', null, 'sidebar'); sidebar.setAttribute('aria-label', '证据目录');
  const perspectives = el('div', null, 'perspectives');
  const oracleView = button('按 oracle', 'view-oracle', () => changeView('oracle'));
  const checkpointView = button('按 checkpoint', 'view-checkpoint', () => changeView('checkpoint'));
  perspectives.append(oracleView, checkpointView);
  const searchLabel = el('label', '搜索'); searchLabel.setAttribute('for', 'search');
  const search = el('input', null, '', 'search'); search.type = 'search'; search.placeholder = 'id、描述、expected、actual';
  const statusLabel = el('label', '状态'); statusLabel.setAttribute('for', 'status-filter');
  const statusFilter = el('select', null, '', 'status-filter');
  const items = el('nav', null, 'items', 'items'); items.setAttribute('aria-label', '条目');
  const count = el('p', '', 'result-count'); count.setAttribute('aria-live', 'polite');
  const detail = el('section', null, 'detail', 'detail'); detail.setAttribute('aria-label', '证据详情');
  sidebar.append(perspectives, searchLabel, search, statusLabel, statusFilter, count, items);
  workspace.append(sidebar, detail);
  const lightbox = el('div', null, 'lightbox', 'lightbox'); lightbox.hidden = true;
  lightbox.setAttribute('role', 'dialog'); lightbox.setAttribute('aria-modal', 'true'); lightbox.setAttribute('aria-label', '截图放大');
  const close = button('关闭截图 (Escape)', 'lightbox-close', closeLightbox);
  const imageArea = el('div', null, 'lightbox-image'); lightbox.append(close, imageArea);
  document.body.replaceChildren(header, workspace, lightbox);
  let returnFocus;
  let selection = parseHash(window.location.hash) ?? { view: 'oracle', id: catalog.oracles[0]?.id };

  function closeLightbox() {
    lightbox.hidden = true; imageArea.replaceChildren(); returnFocus?.focus();
  }
  function openLightbox(evidence, trigger) {
    returnFocus = trigger;
    const image = el('img'); image.src = evidence.url; image.alt = evidence.name;
    imageArea.replaceChildren(image); lightbox.hidden = false; close.focus();
  }
  document.addEventListener('keydown', event => {
    if (lightbox.hidden) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'Tab') { event.preventDefault(); close.focus(); }
  });
  lightbox.addEventListener('click', event => { if (event.target === lightbox) closeLightbox(); });

  function navigate(view, id) {
    selection = { view, id };
    window.location.hash = `#${view}=${encodeURIComponent(id)}`;
    render();
  }
  function changeView(view) {
    const collection = view === 'oracle' ? catalog.oracles : catalog.checkpoints;
    statusFilter.value = ''; search.value = '';
    navigate(view, collection[0]?.id ?? '');
  }
  function link(view, id, text, nodeId) {
    const node = el('a', text ?? id, '', nodeId); node.href = `#${view}=${encodeURIComponent(id)}`;
    node.addEventListener('click', event => { event.preventDefault(); navigate(view, id); });
    return node;
  }
  function field(parent, label, value, id) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    const section = el('div', null, 'field'); section.append(el('h3', label), el('pre', value, 'literal', id)); parent.append(section);
  }
  function observationNode(observation) {
    const article = el('article', null, 'observation');
    const heading = el('div', null, 'observation-heading');
    heading.append(el('strong', observation.obs_id, 'identifier'), badge(observation.status)); article.append(heading);
    if (observation.expired) article.append(el('p', '已过期，不计入当前状态', 'notice'));
    if (observation.superseded_by) article.append(el('p', `已被 ${observation.superseded_by} 纠偏`, 'notice'));
    if (observation.supersedes) article.append(el('p', `纠偏 ${observation.supersedes}`, 'metadata'));
    article.append(el('p', `时间: ${observation.at || '未记录'} / batch: ${display(observation.batch)} / plan_rev: ${display(observation.plan_rev)}`, 'metadata'));
    field(article, 'Actual', observation.actual); field(article, 'Limits', observation.limits);
    const evidenceList = el('div', null, 'evidence-list');
    for (const [index, evidence] of observation.evidence.entries()) {
      const label = `${evidence.name} (${evidence.kind}, ${evidence.scope})`;
      // Only opaque same-origin asset URLs from the catalog can become DOM URLs.
      if (evidence.unavailable || !/^\/asset\/[a-f0-9]{24}$/.test(evidence.url ?? '')) {
        evidenceList.append(el('p', `${label} — 不可用（缺失或按策略不提供下载）`, 'metadata')); continue;
      }
      if (evidence.kind === 'screenshot') {
        const trigger = button(`放大 ${label}`, `evidence-${observation.obs_id}-${index}`, () => openLightbox(evidence, trigger));
        evidenceList.append(trigger);
      } else if (evidence.kind === 'dom') {
        const assetLink = el('a', `查看 ${label}`); assetLink.href = evidence.url; assetLink.target = '_blank'; assetLink.rel = 'noopener noreferrer'; evidenceList.append(assetLink);
      }
    }
    article.append(evidenceList); return article;
  }
  function timeline(parent, checkpoint) {
    const observations = catalog.observations.filter(obs => obs.checkpoint_id === checkpoint.id);
    if (!observations.length) { parent.append(el('p', '尚无观察记录', 'empty')); return; }
    for (const group of groupObservations(observations, catalog.env_keys)) {
      const loop = el('section', null, 'loop'); loop.append(el('h3', `Loop ${group.loop}`));
      const columns = el('div', null, 'env-columns');
      for (const column of group.columns) {
        const env = el('section', null, 'env-column');
        env.append(el('h4', catalog.env_keys.map(key => `${key}: ${key in column.env ? display(column.env[key]) : '—'}`).join(' / ') || '无环境维度', 'env-heading'));
        for (const observation of column.observations) env.append(observationNode(observation));
        columns.append(env);
      }
      loop.append(columns); parent.append(loop);
    }
  }
  function renderDetail() {
    detail.replaceChildren();
    const isOracle = selection.view === 'oracle';
    const item = (isOracle ? catalog.oracles : catalog.checkpoints).find(item => item.id === selection.id);
    if (!item) { detail.append(el('h2', `未找到 ${selection.id ?? ''}`), el('p', '从左侧目录选择一个条目。')); return; }
    const heading = el('div', null, 'detail-heading');
    heading.append(el('h2', `${item.id} ${item.title ?? item.description ?? ''}`), badge(isOracle ? item.rollup : item.status)); detail.append(heading);
    if (isOracle) {
      detail.append(el('p', '查看器计算值，不是验收结论', 'computed-warning'));
      field(detail, 'Expected', item.expected, 'expected'); field(detail, '前置条件', item.precondition); field(detail, '输入', item.input);
      for (const key of ['provenance', 'source', 'path', 'priority']) field(detail, key, item[key]);
      if (!item.checkpoint_ids.length) detail.append(el('p', '未覆盖：没有 oracle checkpoint。', 'notice'));
      for (const id of item.checkpoint_ids) {
        const checkpoint = catalog.checkpoints.find(cp => cp.id === id);
        if (!checkpoint) continue;
        const section = el('section', null, 'checkpoint');
        const title = el('h3'); title.append(link('checkpoint', id, `${id} ${checkpoint.description}`), badge(checkpoint.status));
        section.append(title); timeline(section, checkpoint); detail.append(section);
      }
    } else {
      if (item.origin === 'derived') detail.append(el('p', 'derived：派生 checkpoint，不参与 oracle 汇总', 'notice'));
      const links = el('div', null, 'oracle-links'); links.append(el('span', '关联 oracle: '));
      for (const id of item.oracle_ids) links.append(link('oracle', id, id, `oracle-link-${id}`));
      detail.append(links); field(detail, 'Trail', `${item.trail_id} ${item.trail_name}`); field(detail, 'Focus', item.focus); field(detail, 'Verify', item.verify);
      timeline(detail, item);
    }
  }
  function renderList() {
    const matches = filterItems(catalog, selection.view, search.value, statusFilter.value);
    count.textContent = `${matches.length} 个条目`; items.replaceChildren();
    for (const item of matches) {
      const entry = link(selection.view, item.id, null);
      entry.textContent = '';
      entry.append(el('strong', item.id, 'identifier'), el('span', item.title ?? item.description), badge(selection.view === 'oracle' ? item.rollup : item.status));
      if (item.id === selection.id) entry.setAttribute('aria-current', 'page');
      items.append(entry);
    }
    if (!matches.length) items.append(el('p', '没有匹配项。调整搜索或状态筛选。', 'empty'));
  }
  function render() {
    const currentFilter = statusFilter.value;
    statusFilter.replaceChildren();
    const collection = selection.view === 'oracle' ? catalog.oracles : catalog.checkpoints;
    for (const status of ['', ...new Set(collection.map(item => selection.view === 'oracle' ? item.rollup : item.status))]) {
      const option = el('option', status || '全部状态'); option.value = status; statusFilter.append(option);
    }
    statusFilter.value = currentFilter;
    oracleView.setAttribute('aria-pressed', selection.view === 'oracle'); checkpointView.setAttribute('aria-pressed', selection.view === 'checkpoint');
    renderList(); renderDetail();
  }
  search.addEventListener('input', renderList); statusFilter.addEventListener('change', renderList);
  window.addEventListener('hashchange', () => {
    selection = parseHash(window.location.hash) ?? { view: 'oracle', id: catalog.oracles[0]?.id };
    statusFilter.value = ''; render();
  });
  render();
}

if (typeof document !== 'undefined') {
  fetch('/api/catalog', { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }).then(catalog => mount(document, catalog)).catch(error => {
    const message = document.createElement('p'); message.textContent = `无法加载证据快照 (${error.message})。检查服务后刷新页面。`;
    document.body.replaceChildren(message);
  });
}
