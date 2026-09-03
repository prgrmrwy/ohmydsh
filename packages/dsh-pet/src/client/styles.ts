/**
 * Pet client styles.
 *
 * Owned class names (`dshpet-*`) only, and painted entirely with our own
 * elements: no official DSH class is reused or overridden. Colors come from
 * DSH theme tokens with literal fallbacks so dark and light both stay legible
 * even if a token is missing.
 */

export const PET_CSS = `
/* Pet's own mount node, appended to document.body. It spans nothing and
   paints nothing: it exists so Pet is positioned against the VIEWPORT instead
   of against #root, which a layout-push sidebar squeezes. pointer-events:none
   keeps this wrapper from swallowing clicks meant for the page. */
[data-dsh-pet-host]{pointer-events:none}
/* FIXED against the viewport, not absolute inside the app frame. An absolute
   Pet inherits every containing-block change: dsh-better-sidebar shrinks
   #root itself (margin-right + width:calc), so the whole frame narrows and an
   absolutely positioned Pet gets pushed and clipped. Fixed positioning ignores
   that entirely, which is what "Pet yields to nothing" requires — and note
   z-index alone could never have fixed it, since the problem was the
   containing block rather than stacking order.

   Interaction survives the move because Pet renders on its OWN React root
   (see client/index.tsx): a root establishes its own event-delegation
   container, unlike a portal out of the host root, which silently kills every
   synthetic handler. */
.dshpet-root{position:fixed;z-index:2147483000;width:72px;height:72px;
  pointer-events:auto;touch-action:none}
/* No hover bridge: the wheel is a continuous disc centred on the mascot, so
   there is no dead space to span. The rectangular menu's bridge was a 268px
   strip that now lay ON TOP of the wheel and swallowed slice clicks. */
.dshpet-mascot{position:relative;z-index:3;
  width:72px;height:72px;border:none;padding:0;border-radius:50%;cursor:grab;
  display:flex;align-items:center;justify-content:center;font-size:38px;line-height:1;
  background:var(--dsw-alias-bg-layer-1,#ffffff);
  color:var(--dsw-alias-label-primary,#1f2329);
  box-shadow:0 4px 16px rgba(0,0,0,.18);transition:transform .12s ease,box-shadow .12s ease}
.dshpet-mascot:hover{transform:scale(1.06);box-shadow:0 6px 22px rgba(0,0,0,.24)}
.dshpet-mascot:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:3px}
.dshpet-mascot[data-dragging="true"]{cursor:grabbing}
.dshpet-badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 5px;
  border-radius:9px;font-size:11px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums;
  background:var(--dsw-alias-brand-primary,#0f1115);
  color:var(--dsw-alias-label-primary-foreground,#fff);pointer-events:none}
.dshpet-badge[data-state="degraded"]{background:var(--dsw-alias-state-error-primary,#f54a45)}
.dshpet-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* The wheel is centred on the mascot and may extend past the viewport; the
   mascot and centre stay inside because positioning clamps them. Pointer
   events belong to the slices, not the square that contains them. */
.dshpet-wheel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  pointer-events:none;z-index:2}
.dshpet-wheel-svg{overflow:visible;display:block}
/* Invisible but pointer-opaque: seam clicks stop here instead of focusing
   the page and blurring the wheel closed. */
.dshpet-wheel-catch{fill:transparent;pointer-events:auto}
.dshpet-slot{pointer-events:auto;cursor:pointer;opacity:0;
  animation:dshpet-slot-in .28s ease forwards}
@keyframes dshpet-slot-in{from{opacity:0}to{opacity:1}}
.dshpet-slot-face{fill:var(--dsw-alias-bg-layer-1,#ffffff);
  stroke:var(--dsw-alias-border-l1,#e4e6eb);stroke-width:1;transition:fill .12s ease}
/* Hover reads as a slightly deeper fill: enough to locate the slice without
   competing with the content the wheel floats over. */
.dshpet-slot[data-hovered="true"] .dshpet-slot-face{
  fill:var(--dsw-alias-interactive-bg-hover,#e9ecf1)}
.dshpet-slot[data-disabled="true"]{cursor:not-allowed}
.dshpet-slot[data-disabled="true"] .dshpet-slot-face{opacity:.55}
.dshpet-slot-label{font-size:12px;fill:var(--dsw-alias-label-primary,#1f2329);
  pointer-events:none;user-select:none}
.dshpet-slot[data-disabled="true"] .dshpet-slot-label{
  fill:var(--dsw-alias-label-tertiary,#8f959e)}
/* Keyboard path: visually hidden until focused, then shown in place so the
   focus ring is never invisible. */
.dshpet-wheel-a11y{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  display:flex;flex-direction:column;gap:2px;pointer-events:none}
.dshpet-wheel-item{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;
  background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:13px;cursor:pointer}
.dshpet-wheel-item:focus-visible{position:static;width:auto;height:auto;margin:0;
  overflow:visible;clip:auto;white-space:normal;padding:6px 10px;border-radius:8px;
  pointer-events:auto;outline:2px solid var(--dsw-alias-state-business-primary,#4176e6)}
/* Anchor the notes to the MASCOT's bottom edge, not the wheel box. The wheel
   box is sized for the widest ring (356px), so a top:100% anchor parked the
   note at that far edge — ~140px below the mascot when the wheel was empty,
   which read as a stray tooltip. The wheel is centred on the fixed 72px root
   box, so in wheel coordinates the note's top is the wheel centre (50%) plus
   the mascot's offset from the root centre ((mascot − root)/2), plus the
   mascot radius, plus an 8px gap. --dshpet-mascot-size is set inline on the
   root by the overlay, matching the resizable mascot.
   Scoped to .dshpet-wheel and kept as a TWO-class selector on purpose: the
   note also carries dshpet-empty/dshpet-error, whose padding:6px 0 rules
   come later in source order at the same single-class specificity and
   silently override the card padding — the hint text touched the card edges
   ("no margin" bug). */
.dshpet-wheel .dshpet-wheel-note{pointer-events:auto;position:absolute;
  left:calc(50% + (var(--dshpet-mascot-size,72px) - 72px) / 2);
  top:calc(50% + var(--dshpet-mascot-size,72px) - 72px / 2 + 8px);
  transform:translateX(-50%);max-width:260px;padding:10px;
  border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);
  box-shadow:0 8px 28px rgba(0,0,0,.22);font-size:13px;line-height:20px}
.dshpet-item-label{font-size:13px}
.dshpet-item-hint{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8f959e)}


.dshpet-panel{position:absolute;bottom:78px;right:0;width:340px;max-height:60vh;overflow:auto;
  padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#ffffff);
  box-shadow:0 8px 28px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-panel h2{font-size:13px;margin:0 0 8px;font-weight:600}
.dshpet-tabs{display:flex;gap:4px;margin-bottom:8px}
.dshpet-tab{border:none;background:transparent;font:inherit;font-size:12px;padding:4px 8px;
  border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73)}
.dshpet-tab[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover,#0000000f);
  color:var(--dsw-alias-label-primary,#1f2329)}
/* The whole row navigates to the executor session, so it must read as
   clickable — the default arrow makes it look inert. */
.dshpet-task{border-top:1px solid var(--dsw-alias-border-l2,#1f232914);padding:8px 0;
  cursor:pointer;border-radius:8px}
.dshpet-task:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
.dshpet-task:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);
  outline-offset:-2px}
.dshpet-inv{display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 0;
  color:var(--dsw-alias-label-secondary,#646a73)}
.dshpet-status{font-size:11px;padding:1px 6px;border-radius:6px;
  background:var(--dsw-alias-interactive-bg-hover,#0000000f)}
.dshpet-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center}
.dshpet-answer{flex:1;min-width:140px;font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2,#1f232914);
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-answer:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}
.dshpet-action{border:none;font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;
  cursor:pointer;background:var(--dsw-alias-interactive-bg-hover,#0000000f);
  color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6)}
.dshpet-empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#8f959e);padding:6px 0}
.dshpet-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#f54a45);padding:6px 0}

@media (max-width:520px){
  .dshpet-panel{width:calc(100vw - 32px)}
}

/* Settings rhythm mirroring the shipped DSH sections (ui-theme's AppearanceRow):
   a bordered group per heading, 8px internal gap, 16px vertical padding.
   Every selector stays under an owned dshpet- class and targets an owned
   class, so nothing here can reach a DSH element. */
.dshpet-settings .dshpet-group{border-bottom:1px solid var(--dsw-alias-border-l2,#1f232914);
  display:flex;flex-direction:column;gap:8px;padding:16px 0}
.dshpet-settings .dshpet-group:last-child{border-bottom:none}
.dshpet-settings .dshpet-group-title{margin:0;
  font:var(--dsw-font-s-14,400 14px/22px inherit);
  color:var(--dsw-alias-label-primary,#0f1115)}
/* Stack each label above its control: side-by-side labels made the inputs
   crowd their own text and left the column ragged. */
.dshpet-settings .dshpet-field{display:flex;flex-direction:column;gap:4px;min-width:0;
  font:var(--dsw-font-s-14,400 14px/22px inherit);
  color:var(--dsw-alias-label-secondary,#61666b)}
.dshpet-settings .dshpet-input{width:100%;max-width:360px;box-sizing:border-box;
  height:28px;padding:0 8px;font:inherit;font-size:14px;
  color:var(--dsw-alias-label-primary,#1f2329);
  background:var(--dsw-alias-bg-layer-1,#fff);
  border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:8px;outline:none}
.dshpet-settings .dshpet-input::placeholder{color:var(--dsw-alias-label-dimmed,#cfd3d6)}
.dshpet-settings .dshpet-input:focus,.dshpet-settings .dshpet-input:focus-visible{
  border-color:var(--dsw-alias-state-business-primary,#4176e6)}
/* Two related controls share a row without stretching the whole column. */
.dshpet-settings .dshpet-row{display:flex;flex-direction:row;gap:12px;
  align-items:flex-end;flex-wrap:wrap}
.dshpet-settings .dshpet-row .dshpet-field{flex:1;min-width:140px}

/* Settings page typography follows DSH's own settings sections: 14px primary
   text on 22px line height, 13px secondary, 28px controls, 8px stack gap.
   The floating panel keeps its own compact scale — it is a HUD, not a page. */
.dshpet-settings{font:var(--dsw-font-s-14,400 14px/22px inherit);
  color:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings .dshpet-action{box-sizing:border-box;display:inline-flex;
  align-items:center;justify-content:center;gap:4px;height:32px;padding:0 12px;
  border-radius:16px;font:var(--dsw-font-s-14,400 14px/22px inherit)}
.dshpet-settings .dshpet-item-hint{font:var(--dsw-font-xxs-12,400 12px/18px inherit);
  max-width:560px}
.dshpet-settings .dshpet-error{font:var(--dsw-font-xxs-12,400 12px/18px inherit)}
.dshpet-settings .dshpet-empty{font:var(--dsw-font-xs-13,400 13px/20px inherit)}
.dshpet-settings .dshpet-status{font-size:12px;line-height:18px}
/* Read-only value display: a binding shows its value until you choose Edit. */
.dshpet-readonly{display:inline-flex;align-items:center;min-height:28px;padding:0 8px;
  font-size:14px;color:var(--dsw-alias-label-primary,#1f2329);
  background:var(--dsw-alias-interactive-bg-hover,#0000000a);border-radius:6px}
.dshpet-readonly[data-empty="true"]{color:var(--dsw-alias-label-tertiary,#8f959e)}
/* Environment rows: name + injected name, masked value, actions. The grid keeps
   the three columns aligned across both scopes and the effective view. */
.dshpet-settings .dshpet-env-row{display:grid;
  grid-template-columns:minmax(140px,1fr) minmax(160px,1.4fr) auto;
  gap:12px;align-items:center;padding:8px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l2,#0000001a);
  background:var(--dsw-alias-bg-layer-2,#fff)}
.dshpet-env-key{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshpet-env-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
  color:var(--dsw-alias-label-primary,#1f2329);overflow:hidden;text-overflow:ellipsis}
.dshpet-env-inject{font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,#8f959e);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dshpet-env-value{display:flex;align-items:center;gap:8px;min-width:0}
.dshpet-env-secret{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-settings .dshpet-reveal{flex:none;height:22px;padding:0 8px;font-size:11px;
  line-height:20px;border-radius:11px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2,#0000001a);
  background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-secondary,#61666b)}
.dshpet-settings .dshpet-reveal:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
.dshpet-badge-override{display:inline-block;margin-left:6px;padding:0 6px;height:18px;
  line-height:18px;font-size:11px;border-radius:9px;white-space:nowrap;
  background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}
.dshpet-badge-shadowed{display:inline-block;margin-left:6px;padding:0 6px;height:18px;
  line-height:18px;font-size:11px;border-radius:9px;white-space:nowrap;
  background:var(--dsw-alias-interactive-bg-hover,#0000000a);
  color:var(--dsw-alias-label-tertiary,#8f959e)}
/* A shadowed global entry stays visible but reads as inert, so the override is
   obvious without hiding what it replaced. */
.dshpet-row-shadowed .dshpet-env-name,
.dshpet-row-shadowed .dshpet-env-secret{opacity:.55;text-decoration:line-through}

/* Diagnostics rows: label + value pairs instead of a raw JSON dump. */
.dshpet-facts{display:flex;flex-direction:column;gap:8px;margin:0}
.dshpet-fact{display:flex;gap:12px;align-items:baseline}
.dshpet-fact-key{flex:none;min-width:132px;font-size:13px;
  color:var(--dsw-alias-label-secondary,#646a73)}
.dshpet-fact-value{font-size:14px;word-break:break-all;
  color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-fact-value code{font-size:13px}
/* In-app Host directory browser, used where no OS picker exists. */
.dshpet-browser{display:flex;flex-direction:column;gap:8px;padding:12px;
  border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2,#fff)}
.dshpet-crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.dshpet-browser-list{display:flex;flex-direction:column;gap:2px;
  max-height:220px;overflow:auto}
/* Two-level selector, matching the settings action rule that centers its
   label. A single-class rule loses on specificity, which is why the entries
   rendered centered instead of as a left-aligned list. */
.dshpet-settings .dshpet-browser-entry{justify-content:flex-start;text-align:left;
  width:100%;background:0 0;height:32px;padding:0 8px;border-radius:6px;
  color:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings .dshpet-browser-entry:hover{
  background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
/* The crumb trail is a row of small buttons; keep it left-aligned too. */
.dshpet-settings .dshpet-crumbs{justify-content:flex-start}
/* Folder row: icon, name, and a drill-in chevron pinned to the right. */
.dshpet-browser-icon{flex:none;font-size:14px;line-height:1}
.dshpet-browser-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.dshpet-browser-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#81858c)}
/* Accent swatches: each shows the paw in its own colour on the neutral panel
   surface, so the chip previews exactly what the mascot will look like. */
.dshpet-swatches{display:flex;flex-wrap:wrap;gap:8px}
.dshpet-settings .dshpet-swatch{width:36px;height:36px;padding:0;border-radius:50%;
  background:var(--dsw-alias-bg-layer-1,#fff);
  display:inline-flex;align-items:center;justify-content:center;font-size:17px;
  line-height:1;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2,#0000001a);
  box-shadow:0 1px 3px rgba(0,0,0,.10);transition:transform .12s ease}
.dshpet-settings .dshpet-swatch:hover{transform:scale(1.08)}
.dshpet-settings .dshpet-swatch[data-selected="true"]{
  border:2px solid var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings .dshpet-swatch:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}
/* Button variants. Two-level selectors, matching the settings action rule
   they must override — a single-class rule loses on specificity and the
   variant silently has no effect. */
.dshpet-settings .dshpet-action-primary{
  background:var(--dsw-alias-button-primary-fill,#0f1115);
  color:var(--dsw-alias-label-primary-foreground,#fff)}
.dshpet-settings .dshpet-action-primary:hover:not(:disabled){
  background:var(--dsw-alias-button-primary-hover,#2a2d33)}
/* Destructive actions need a visual warning: Remove sat identical to Enable. */
.dshpet-settings .dshpet-action-danger{
  color:var(--dsw-alias-state-error-primary,#ec1313)}
.dshpet-settings .dshpet-action-danger:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover-danger,#ec13131a)}
.dshpet-settings .dshpet-action-sm{height:28px;padding:0 10px;border-radius:14px;
  font:var(--dsw-font-xxs-12,400 12px/18px inherit)}
/* Inline code, for paths and identifiers. */
.dshpet-code{display:inline-flex;align-items:center;padding:0 5px;border-radius:6px;
  font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:.875em;
  background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
/* Installed-Skill row heading. */
.dshpet-settings .dshpet-task-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshpet-settings .dshpet-task-name{
  font:var(--dsw-font-s-strong-14,500 14px/22px inherit);
  color:var(--dsw-alias-label-primary,#0f1115)}
/* Enabled state must be visually distinct from not-enabled. */
.dshpet-settings .dshpet-status[data-tone="enabled"]{
  color:var(--dsw-alias-state-success-primary,#1a7f37)}
`
