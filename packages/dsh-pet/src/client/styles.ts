/**
 * Pet client styles.
 *
 * Owned class names (`dshpet-*`) only, and painted entirely with our own
 * elements: no official DSH class is reused or overridden. Colors come from
 * DSH theme tokens with literal fallbacks so dark and light both stay legible
 * even if a token is missing.
 */

export const PET_CSS = `
/* ABSOLUTE inside the shell overlay layer. That layer is inset 0 over a
   full-height frame, so it already spans the visible area — and staying in it
   keeps React's synthetic events working. Re-parenting to the document body
   moved the node outside React's delegation container, which silently killed
   hover, drag and click while the element still rendered. */
.dshpet-root{position:absolute;z-index:999;width:72px;height:72px;
  pointer-events:auto;touch-action:none}
/* The menu and panel render ABOVE the mascot, outside the 72px box. Without a
   bridge the pointer crosses dead space on its way there, firing mouseleave
   and collapsing the menu before it can be used. This pseudo-element spans
   the gap so the hover region is continuous, and it only exists while open. */
.dshpet-root[data-open="true"]::before{content:'';position:absolute;
  left:-260px;right:-8px;bottom:100%;height:12px}
.dshpet-mascot{width:72px;height:72px;border:none;padding:0;border-radius:50%;cursor:grab;
  display:flex;align-items:center;justify-content:center;font-size:38px;line-height:1;
  background:var(--dsw-alias-bg-layer-1,#ffffff);
  color:var(--dsw-alias-label-primary,#1f2329);
  box-shadow:0 4px 16px rgba(0,0,0,.18);transition:transform .12s ease,box-shadow .12s ease}
.dshpet-mascot:hover{transform:scale(1.06);box-shadow:0 6px 22px rgba(0,0,0,.24)}
.dshpet-mascot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3370ff);outline-offset:3px}
.dshpet-mascot[data-dragging="true"]{cursor:grabbing}
.dshpet-badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 5px;
  border-radius:9px;font-size:11px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums;
  background:var(--dsw-alias-brand-primary,#3370ff);color:#fff;pointer-events:none}
.dshpet-badge[data-state="degraded"]{background:var(--dsw-alias-state-error-primary,#f54a45)}
.dshpet-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

.dshpet-radial{position:absolute;inset:auto;bottom:78px;right:0;min-width:212px;padding:6px;
  border-radius:12px;background:var(--dsw-alias-bg-layer-1,#ffffff);
  box-shadow:0 8px 28px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:2px}
.dshpet-item{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:none;border-radius:8px;
  background:transparent;text-align:left;cursor:pointer;font:inherit;
  color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#0000000f)}
.dshpet-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3370ff);outline-offset:-2px}
.dshpet-item:disabled{cursor:not-allowed;opacity:.55}
.dshpet-item-label{font-size:13px}
.dshpet-item-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8f959e)}

.dshpet-chip{display:flex;align-items:center;gap:6px;padding:6px 10px;margin-bottom:4px;
  border-radius:8px;font-size:12px;background:var(--dsw-alias-interactive-bg-hover,#0000000a);
  color:var(--dsw-alias-label-secondary,#646a73)}
.dshpet-chip-remove{margin-left:auto;border:none;background:transparent;cursor:pointer;
  font:inherit;color:var(--dsw-alias-label-tertiary,#8f959e);padding:0 2px;border-radius:4px}
.dshpet-chip-remove:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3370ff)}

.dshpet-panel{position:absolute;bottom:78px;right:0;width:340px;max-height:60vh;overflow:auto;
  padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#ffffff);
  box-shadow:0 8px 28px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-panel h2{font-size:13px;margin:0 0 8px;font-weight:600}
.dshpet-tabs{display:flex;gap:4px;margin-bottom:8px}
.dshpet-tab{border:none;background:transparent;font:inherit;font-size:12px;padding:4px 8px;
  border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73)}
.dshpet-tab[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover,#0000000f);
  color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-task{border-top:1px solid var(--dsw-alias-border-l2,#1f232914);padding:8px 0}
.dshpet-inv{display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 0;
  color:var(--dsw-alias-label-secondary,#646a73)}
.dshpet-status{font-size:11px;padding:1px 6px;border-radius:6px;
  background:var(--dsw-alias-interactive-bg-hover,#0000000f)}
.dshpet-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center}
.dshpet-answer{flex:1;min-width:140px;font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2,#1f232914);
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-answer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3370ff);outline-offset:1px}
.dshpet-action{border:none;font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;
  cursor:pointer;background:var(--dsw-alias-interactive-bg-hover,#0000000f);
  color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3370ff)}
.dshpet-empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#8f959e);padding:6px 0}
.dshpet-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#f54a45);padding:6px 0}

@media (max-width:520px){
  .dshpet-panel{width:calc(100vw - 32px)}
  .dshpet-radial{min-width:180px}
}

/* Settings rhythm mirroring the shipped DSH sections (ui-theme's AppearanceRow):
   a bordered group per heading, 8px internal gap, 16px vertical padding.
   Every selector stays under an owned dshpet- class and targets an owned
   class, so nothing here can reach a DSH element. */
.dshpet-settings .dshpet-group{border-bottom:1px solid var(--dsw-alias-border-l2,#1f232914);
  display:flex;flex-direction:column;gap:8px;padding:16px 0}
.dshpet-settings .dshpet-group:last-child{border-bottom:none}
.dshpet-settings .dshpet-group-title{margin:0;color:var(--dsw-alias-label-primary,#1f2329);
  font-size:14px;font-weight:500;line-height:22px}
/* Stack each label above its control: side-by-side labels made the inputs
   crowd their own text and left the column ragged. */
.dshpet-settings .dshpet-field{display:flex;flex-direction:column;gap:6px;
  color:var(--dsw-alias-label-secondary,#646a73);font-size:13px;line-height:20px}
.dshpet-settings .dshpet-input{width:100%;max-width:320px;box-sizing:border-box;
  height:32px;padding:0 10px;font:inherit;font-size:13px;
  color:var(--dsw-alias-label-primary,#1f2329);
  background:var(--dsw-alias-bg-layer-1,#fff);
  border:1px solid var(--dsw-alias-border-l2,#1f232914);border-radius:6px}
.dshpet-settings .dshpet-input:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#3370ff);outline-offset:1px}
/* Two related controls share a row without stretching the whole column. */
.dshpet-settings .dshpet-row{display:flex;flex-direction:row;gap:12px;
  align-items:flex-end;flex-wrap:wrap}
.dshpet-settings .dshpet-row .dshpet-field{flex:1;min-width:140px}
`
