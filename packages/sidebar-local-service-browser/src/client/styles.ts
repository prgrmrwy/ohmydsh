/**
 * Tab styles (ui-design.md): DSH theme variables only (light/dark follow DSH), every selector under
 * `.dshls-tab`, injected once as `<style data-dshls-style>`. No gradients, shadows or new colour values.
 */
export const STYLE_ATTR = 'data-dshls-style'

export const TAB_CSS = `
.dshls-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; box-sizing: border-box; container-type: inline-size;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; }
.dshls-tab *, .dshls-tab *::before, .dshls-tab *::after { box-sizing: border-box; }
.dshls-toolbar { display: flex; align-items: center; gap: 6px; height: 36px; flex: none; padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dshls-tab button { font: inherit; color: inherit; background: transparent; border: 0; margin: 0; padding: 0; cursor: pointer; }
.dshls-tab button:disabled { opacity: 0.4; cursor: default; }
.dshls-tab button:focus-visible, .dshls-tab a:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.dshls-icon-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; flex: none;
  transition: background-color 120ms; }
.dshls-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshls-back { width: 28px; height: 28px; }
.dshls-route { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; height: 28px; padding: 0 2px 0 8px; margin: 0;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; }
.dshls-route:focus-within { border-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dshls-host { display: inline-flex; align-items: center; gap: 5px; flex: none; color: var(--dsw-alias-label-secondary); }
.dshls-host svg { color: var(--dsw-alias-brand-primary); }
.dshls-sep { width: 1px; height: 14px; flex: none; background: var(--dsw-alias-border-l2); }
.dshls-address { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; padding: 0;
  color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code); font-size: 12.5px; }
.dshls-address::placeholder { color: var(--dsw-alias-label-tertiary); }
.dshls-open { width: 24px; height: 24px; color: var(--dsw-alias-label-secondary); }
.dshls-note { flex: none; padding: 6px 12px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.dshls-inline-error { flex: none; padding: 0 12px 6px; color: var(--dsw-alias-state-error-primary); }
.dshls-external { display: flex; align-items: center; gap: 10px; flex: none; padding: 6px 12px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); }
.dshls-external a { color: var(--dsw-alias-label-primary); text-decoration: underline; }
.dshls-external .dshls-close { width: 22px; height: 22px; margin-left: auto; }
.dshls-body { position: relative; flex: 1; min-height: 0; display: flex; }
/* The one hard-coded colour: it is the web page's default canvas (pages assume white + light scheme), not DSH UI. */
.dshls-frame { flex: 1; width: 100%; border: 0; color-scheme: light; background: #fff; }
.dshls-frame[hidden] { display: none; }
.dshls-panel { flex: 1; padding: 24px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.dshls-panel h2 { margin: 0 0 6px; font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
.dshls-panel[role="alert"] h2 { color: var(--dsw-alias-state-error-primary); }
.dshls-panel h2, .dshls-panel p { max-width: 46ch; }
.dshls-panel p { margin: 0 0 12px; }
.dshls-services { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.dshls-service { display: flex !important; align-items: baseline; gap: 12px; width: 100%; padding: 6px 8px !important; border-radius: 6px; text-align: left;
  transition: background-color 120ms; }
.dshls-service:hover { background: var(--dsw-alias-interactive-bg-hover) !important; }
.dshls-service-port { font-family: var(--ds-font-family-code); font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.dshls-service-proc { color: var(--dsw-alias-label-tertiary); }
.dshls-refresh { display: inline-flex !important; align-items: center; gap: 6px; margin-top: 8px !important; padding: 4px 8px !important; border-radius: 6px;
  color: var(--dsw-alias-label-secondary) !important; transition: background-color 120ms; }
.dshls-refresh:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover) !important; }
@container (max-width: 320px) { .dshls-host-text { display: none; } }
@media (prefers-reduced-motion: reduce) { .dshls-icon-btn, .dshls-service, .dshls-refresh { transition: none; } }
`
