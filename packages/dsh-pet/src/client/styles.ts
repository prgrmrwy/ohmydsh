/**
 * Pet client styles.
 *
 * Owned class names (`dshpet-*`) only, and painted entirely with our own
 * elements: no official DSH class is reused or overridden. Colors come from
 * DSH theme tokens with literal fallbacks so dark and light both stay legible
 * even if a token is missing.
 *
 * 0.1.2 token migration: the theme dropped `--dsw-alias-brand-primary`,
 * `--dsw-alias-label-primary-foreground`, `--dsw-font-s-14`,
 * `--dsw-alias-bg-layer-2` and the `button-primary-*` pair. Same-appearance
 * remaps (verified against the 0.1.2 vocabulary the client.test suite derives
 * from the installed bundles): badge chip = label-primary on bg-layer-1
 * (inverts per theme like the old pair), body font = plain 14px/22px over
 * `--dsw-font-family`, elevated surfaces = bg-layer-1 (the same light value
 * the old layer-2 resolved to), primary buttons = `button-info-fill` /
 * `button-info-hover` (the pair the official composer primary uses in 0.1.2).
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
   synthetic handler.

   z-index:999, not "as high as possible". Pet's mount path (document.body >
   host > .dshpet-root) and the official Settings overlay's ancestor chain
   (#root > AppFrame) both establish no new stacking context (no transform /
   filter / isolation / contain), so Pet and Settings compare directly in the
   ROOT stacking context. The shipped Settings panel
   (@deepseek-ai/dsh-client-ui-settings-general's SettingsRoot.module.css)
   sits at z-index:1000 — 999 is one below that known value, deliberately
   STRICTLY less rather than equal: at equal values the two fixed layers
   would resolve by DOM insertion order instead, which is exactly the
   unreliable "depends on which mounted last" outcome the old
   near-int32-max value(2147483000) papered over by brute force. Observed
   "ordinary content" z-index values across every deployed DSH/plugin bundle
   top out at 100 (see fix-pet-below-settings-layer/design.md), so 999 keeps
   a wide margin above ordinary content while staying below the first known
   "top-layer modal" tier (Settings, attachment lightbox/drop mask, this
   deployment's better-sidebar mermaid modal — all 1000+). A future plugin
   value landing between 100 and 999 is a real risk this constant alone
   cannot detect; see that design doc for the full survey and rationale. */
.dshpet-root{position:fixed;z-index:999;width:72px;height:72px;
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
  background:var(--dsw-alias-label-primary,#0f1115);
  color:var(--dsw-alias-bg-layer-1,#fff);pointer-events:none}
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
/* Anchor the notes below the RINGS, not below the mascot and not to the wheel
   box.

   Two wrong anchors preceded this one. "top:100%" used the wheel BOX, which is
   sized for the widest ring it could ever draw (356px), parking the note far
   below a wheel that usually draws fewer rings. Anchoring to the mascot's
   bottom edge fixed that but overcorrected: the mascot is only the innermost
   72px of a disc that reaches 94px with one ring and 170px with three, so the
   note sat ON TOP of the rings (44px from the centre against a 132px ring
   edge in the two-ring case).

   The correct clearance is the radius of the rings actually drawn, which the
   overlay computes for its own hover test and publishes as
   --dshpet-wheel-radius. The fallback is the one-ring radius rather than the
   mascot, so a missing variable still clears something.

   Scoped to .dshpet-wheel and kept as a TWO-class selector on purpose: the
   note also carries dshpet-empty/dshpet-error, whose padding:6px 0 rules
   come later in source order at the same single-class specificity and
   silently override the card padding — the hint text touched the card edges
   ("no margin" bug). */
.dshpet-wheel .dshpet-wheel-note{pointer-events:auto;position:absolute;
  left:calc(50% + (var(--dshpet-mascot-size,72px) - 72px) / 2);
  top:calc(50% + var(--dshpet-wheel-radius,94px) + 12px);
  /* The note is a "p": its UA margin (13px here) would add itself to the gap
     above, making the computed clearance drift with the browser's default
     rather than being the 12px this rule states. */
  margin:0;
  transform:translateX(-50%);max-width:260px;padding:10px;
  border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);
  box-shadow:0 8px 28px rgba(0,0,0,.22);font-size:13px;line-height:20px}
.dshpet-wheel .dshpet-wheel-note.dshpet-wheel-receipt{
  /* A receipt reports what already happened, so it must not sit in front of
     anything the user might click next: it fades on its own and stays
     transparent to the pointer while visible. */
  pointer-events:none;
  color:var(--dsw-alias-label-secondary,#646a73);
  animation:dshpet-receipt-fade 6s ease-in forwards}
@keyframes dshpet-receipt-fade{0%,72%{opacity:1}100%{opacity:0}}
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
/* Inline dismissal inside a wheel note: a link-weight affordance, so it
   reads as secondary to the hint it sits in rather than as an action. */
/* Identity chip: reads as the person, not the id. The id itself lives in the
   title attribute and on the clipboard, so it costs no line width. */
.dshpet-identity{border:0;background:none;padding:0;cursor:pointer;font:inherit;
color:var(--dsw-alias-label-primary,#1f2329);text-align:left}
.dshpet-identity:hover{text-decoration:underline}
.dshpet-identity-hint{margin-left:6px;font-size:11px;
color:var(--dsw-alias-label-tertiary,#8f959e);opacity:0;transition:opacity .12s}
.dshpet-identity:hover .dshpet-identity-hint,
.dshpet-identity:focus-visible .dshpet-identity-hint{opacity:1}
.dshpet-note-dismiss{margin-left:6px;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary,#646a73);text-decoration:underline}
.dshpet-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#f54a45);padding:6px 0}

@media (max-width:520px){
  .dshpet-panel{width:calc(100vw - 32px)}
}

/* ─────────────────────────────────────────────────────────────────────────
   Settings surface.

   The rhythm mirrors the shipped DSH settings sections rather than inventing
   one: "dsh-client-ui-settings-plugins" underlines its active tab instead of
   filling a chip, "dsh-client-ui-settings-models" groups related controls in
   a ".5px" bordered card at radius 16, and "dsh-client-ui-theme" separates
   stacked groups with a ".5px" divider. Pet had none of that — every tab was
   one flat, undifferentiated column of rows at a single visual weight, so
   nothing indicated which control belonged to which concern.

   Three depth levels carry that hierarchy now, and they are the whole system:

     1. tab strip   — underlined, 13px, the page's top-level switch
     2. group       — a titled section; collapsible when it is reference
                      material rather than a primary control
     3. card / row  — one bordered object inside a group (a Skill, an
                      env var, an onboarding step, a chat route)

   Every selector stays under an owned "dshpet-" class and targets an owned
   class, so nothing here can reach a DSH element.
   ───────────────────────────────────────────────────────────────────────── */
.dshpet-settings{font:400 14px/22px var(--dsw-font-family,inherit);
  color:var(--dsw-alias-label-primary,#0f1115);max-width:760px;
  display:flex;flex-direction:column;gap:2px}

/* Tab strip: an underline marks the active tab, matching the shipped plugins
   settings section. The old filled chip read as a button rather than as
   navigation, and at 12px it competed with the group titles below it. */
.dshpet-settings-tabs{display:flex;align-items:flex-end;gap:22px;
  margin:0 0 4px;border-bottom:.5px solid var(--dsw-alias-border-l2,#1f232914)}
.dshpet-settings-tab{position:relative;border:0;background:0 0;font:inherit;
  font-size:13px;line-height:20px;padding:7px 1px 9px;cursor:pointer;
  color:var(--dsw-alias-label-tertiary,#8f959e)}
.dshpet-settings-tab:hover,
.dshpet-settings-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings-tab[aria-selected="true"]::after{content:"";position:absolute;
  left:0;right:0;bottom:-1px;height:2px;border-radius:2px 2px 0 0;
  background:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings-tab:focus-visible{border-radius:2px;
  color:var(--dsw-alias-label-primary,#0f1115);
  outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}

/* A group is a titled section. The divider is ".5px" like DSH's own, not the
   heavier 1px rule Pet used, so stacked groups separate without banding. */
.dshpet-settings .dshpet-group{display:flex;flex-direction:column;gap:8px;
  padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,#1f232914)}
.dshpet-settings .dshpet-group:last-child{border-bottom:none}
.dshpet-settings .dshpet-group-title{margin:0;
  font:500 14px/22px var(--dsw-font-family,inherit);
  color:var(--dsw-alias-label-primary,#0f1115)}

/* Segmented control for filtering a list WITHIN a group.

   Deliberately a different shape from the page tab strip above it: that one
   underlines to say "you are on a different page", while this one is a filled
   segment that says "you are looking at a subset of one list". Reusing the
   underline here would have read as a second, competing level of navigation. */
.dshpet-settings .dshpet-subtabs{display:inline-flex;align-items:center;gap:2px;
  padding:2px;border-radius:10px;align-self:flex-start;
  background:var(--dsw-alias-bg-module-platform,#0000000a)}
.dshpet-settings .dshpet-subtab{display:inline-flex;align-items:center;gap:6px;
  box-sizing:border-box;height:28px;padding:0 12px;border:0;border-radius:8px;
  background:0 0;cursor:pointer;font:400 13px/20px var(--dsw-font-family,inherit);
  color:var(--dsw-alias-label-secondary,#61666b)}
.dshpet-settings .dshpet-subtab:hover{color:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings .dshpet-subtab[aria-selected="true"]{
  background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#0f1115);font-weight:500}
.dshpet-settings .dshpet-subtab:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}
/* The count rides the tab so an empty group is visible before it is opened. */
.dshpet-settings .dshpet-subtab-count{font-size:11px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-tertiary,#8f959e)}
.dshpet-settings .dshpet-subtab[aria-selected="true"] .dshpet-subtab-count{
  color:var(--dsw-alias-label-secondary,#61666b)}

/* Collapsible group.

   Not every group is a control the user came for: import instructions, file
   health, security notes and effective-value tables are reference material
   that dominated the page purely by being printed in full. "<details>" keeps
   them one click away and, being native, needs no state, no ARIA wiring and
   no keyboard handler of its own. Primary controls stay expanded. */
.dshpet-settings .dshpet-fold{display:block;padding:0;gap:0}
.dshpet-settings .dshpet-fold-head{display:flex;align-items:center;gap:8px;
  list-style:none;cursor:pointer;padding:16px 0;
  font:500 14px/22px var(--dsw-font-family,inherit);
  color:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings .dshpet-fold-head::-webkit-details-marker{display:none}
.dshpet-settings .dshpet-fold-head:focus-visible{border-radius:8px;
  outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}
/* Own chevron rather than the platform triangle, which differs per browser
   and cannot be positioned. It rotates to point down while open. */
.dshpet-settings .dshpet-fold-mark{flex:none;display:inline-flex;
  align-items:center;justify-content:center;width:14px;height:22px;
  font-size:11px;line-height:1;transition:transform .16s ease;
  color:var(--dsw-alias-label-tertiary,#8f959e)}
.dshpet-settings .dshpet-fold[open] .dshpet-fold-mark{transform:rotate(90deg)}
.dshpet-settings .dshpet-fold-title{flex:1;min-width:0}
/* A one-line summary of what is inside, so the group can be judged closed. */
.dshpet-settings .dshpet-fold-note{flex:none;
  font:var(--dsw-font-xxs-12,400 12px/18px inherit);
  color:var(--dsw-alias-label-tertiary,#8f959e)}
.dshpet-settings .dshpet-fold-body{display:flex;flex-direction:column;gap:8px;
  padding:0 0 16px}

/* Card: one bordered object inside a group — a Skill, an env var, a chat
   route. Previously these were bare rows separated only by a top border, so a
   list of them read as one undifferentiated block. */
.dshpet-settings .dshpet-card{display:flex;flex-direction:column;gap:10px;
  padding:12px 14px;border-radius:16px;
  border:.5px solid var(--dsw-alias-border-l4,#0000001a);
  background:var(--dsw-alias-bg-layer-1,#fff)}
.dshpet-settings .dshpet-card-head{display:flex;align-items:center;gap:10px;
  flex-wrap:wrap}
.dshpet-settings .dshpet-card-name{min-width:0;
  font:500 14px/22px var(--dsw-font-family,inherit);
  color:var(--dsw-alias-label-primary,#0f1115)}
/* Actions sit at the trailing edge so every card exposes the same hit line. */
.dshpet-settings .dshpet-card-tail{display:inline-flex;align-items:center;
  gap:4px;margin-left:auto}
.dshpet-settings .dshpet-cards{display:flex;flex-direction:column;gap:8px;
  margin:0;padding:0;list-style:none}

/* Callout: a warning or a note that must not read as body prose. Pet used
   ".dshpet-error" (plain red text) for security warnings, which looked like a
   failure that had already happened rather than a caution.

   Neutral surface, ordinary label colour, and the TONE carried by a 3px rule
   down the leading edge. The first attempt filled the whole block with the
   state colour and coloured the text with a neighbouring step of the same
   ramp, which failed twice over: "state-warn-secondary" is amber-400
   (#f7ad31), a full-strength fill rather than the tint its name suggests, and
   pairing it with "state-warn-label" (amber-600, #dd8629) left body text at a
   1.46:1 contrast ratio — far under the 4.5:1 minimum, and glaring besides.
   The ramps offer no darker amber to fix the text with, so the fill itself is
   the wrong instrument.

   Keeping the surface neutral also fixes this for dark mode for free: both
   the background and the label resolve per theme, whereas a static amber fill
   does not. */
.dshpet-settings .dshpet-callout{display:flex;flex-direction:column;gap:4px;
  padding:10px 12px;border-radius:8px;border-left:3px solid transparent;
  font:var(--dsw-font-xxs-12,400 12px/18px inherit);
  background:var(--dsw-alias-bg-module-platform,#0000000a);
  color:var(--dsw-alias-label-secondary,#61666b)}
.dshpet-settings .dshpet-callout[data-tone="warn"]{
  border-left-color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dshpet-settings .dshpet-callout[data-tone="danger"]{
  border-left-color:var(--dsw-alias-state-error-primary,#ec1313)}

/* Stack each label above its control: side-by-side labels made the inputs
   crowd their own text and left the column ragged. */
.dshpet-settings .dshpet-field{display:flex;flex-direction:column;gap:4px;min-width:0;
  font:400 14px/22px var(--dsw-font-family,inherit);
  color:var(--dsw-alias-label-secondary,#61666b)}
/* One control height for the whole page: 32px, shared by the input, the
   action button and the read-only value. They previously stood at 34 / 32 /
   28, so any row combining them (every stored field, every add form) met at
   mismatched edges and put their text on three different lines. */
.dshpet-settings .dshpet-input{width:100%;max-width:360px;box-sizing:border-box;
  height:32px;padding:0 10px;font:inherit;font-size:13px;line-height:20px;
  color:var(--dsw-alias-label-primary,#1f2329);
  background:var(--dsw-alias-bg-layer-1,#fff);
  border:.5px solid var(--dsw-alias-border-l4,#0000001a);border-radius:8px;outline:none}
.dshpet-settings .dshpet-input::placeholder{color:var(--dsw-alias-label-dimmed,#cfd3d6)}
.dshpet-settings .dshpet-input:focus,.dshpet-settings .dshpet-input:focus-visible{
  border-color:var(--dsw-alias-state-business-primary,#4176e6)}
/* A checkbox is not a text box: the shared input sizing stretched it into a
   34px-tall block. */
.dshpet-settings .dshpet-input[type="checkbox"]{width:16px;height:16px;
  max-width:16px;padding:0;flex:none;accent-color:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings .dshpet-check{display:inline-flex;align-items:center;gap:8px;
  font:400 14px/22px var(--dsw-font-family,inherit);
  color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer}
/* Two related controls share a row without stretching the whole column.

   "flex-end" was load-bearing only while a labelled field (label stacked over
   its control) had to line its INPUT up with a bare sibling button. Now that
   every control is 32px, bottom-alignment does nothing useful and actively
   hurts: a row mixing a 32px control with a taller wrapped one pins them to
   their bottom edges instead of their text. "end" on the baseline axis keeps
   the labelled-field case working while equal-height controls simply agree. */
.dshpet-settings .dshpet-row{display:flex;flex-direction:row;gap:12px;
  align-items:flex-end;flex-wrap:wrap}
.dshpet-settings .dshpet-row .dshpet-field{flex:1;min-width:140px}

/* Also applied to an "a" (the "打开飞书" AppLink), so the anchor defaults a
   button does not carry — underline, visited colour, inherited link blue —
   are neutralised here rather than in a separate variant. */
.dshpet-settings .dshpet-action{box-sizing:border-box;display:inline-flex;
  align-items:center;justify-content:center;gap:4px;height:32px;padding:0 14px;
  border-radius:16px;cursor:pointer;text-decoration:none;white-space:nowrap;
  border:.5px solid var(--dsw-alias-border-l3,#0000001f);
  background:0 0;color:var(--dsw-alias-label-primary,#0f1115);
  font:400 13px/20px var(--dsw-font-family,inherit)}
.dshpet-settings a.dshpet-action:visited{color:var(--dsw-alias-label-primary,#0f1115)}
.dshpet-settings .dshpet-action:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
.dshpet-settings .dshpet-action:disabled{opacity:.45;cursor:not-allowed}
.dshpet-settings .dshpet-item-hint{font:var(--dsw-font-xxs-12,400 12px/18px inherit);
  color:var(--dsw-alias-label-tertiary,#8f959e);max-width:620px;margin:0}
.dshpet-settings .dshpet-error{font:var(--dsw-font-xxs-12,400 12px/18px inherit);
  color:var(--dsw-alias-state-error-primary,#f54a45)}
.dshpet-settings .dshpet-empty{font:var(--dsw-font-xs-13,400 13px/20px inherit);
  color:var(--dsw-alias-label-tertiary,#8f959e);padding:6px 0}
/* Status pill, matching the badge shipped in the plugins settings section.

   "inline-flex" with its own centred cross axis, rather than a bare inline
   box: the pill carries a dot pseudo-element and 11px text inside a row of
   14px text, and as an inline box its own line-height decided where the dot
   and the label landed relative to each other. Centring inside the pill makes
   that internal alignment explicit; the row it sits in is responsible only
   for placing the pill as a whole. */
.dshpet-settings .dshpet-status{display:inline-flex;align-items:center;
  flex:none;white-space:nowrap;box-sizing:border-box;height:20px;
  padding:0 8px;border-radius:999px;font-size:11px;font-weight:500;line-height:1;
  background:var(--dsw-alias-bg-module-platform,#0000000a);
  color:var(--dsw-alias-label-secondary,#61666b)}
/* A toned pill keeps the neutral surface and states its tone with a dot plus
   the label colour. Filling the pill with "state-*-secondary" looked like a
   button and was unreadable: that token is the 400 step of its ramp (green
   #4ed17e, amber #f7ad31) — a solid colour, not the tint the name implies —
   so "已启用" sat at 1.17:1 against its own background.

   The dot carries the saturated colour instead. It is the one element that
   needs no contrast against the text, so the signal survives while the label
   stays legible on the neutral chip in either theme. */
/* The pill is a flex container, so the dot is a flex ITEM: "vertical-align"
   (which the first version used to nudge it onto the text) does not apply to
   flex items at all and was silently ignored. The parent's "align-items"
   centres it instead, which is also the only way it stays centred when the
   label wraps to a different cap height. */
.dshpet-settings .dshpet-status[data-tone]::before{content:"";flex:none;
  width:6px;height:6px;margin-right:5px;border-radius:50%;
  background:var(--dshpet-tone,currentColor)}
/* The dot is tinted; the LABEL stays the ordinary secondary text colour.
   Colouring 11px text with the ramp itself does not survive the check —
   amber-600 (#dd8629) is the darkest orange available and still lands at
   2.58:1 on the neutral chip, under the 4.5:1 minimum, with no darker step to
   reach for. Since the dot needs no contrast against the label, moving the
   hue there keeps the state readable at a glance AND legible. */
.dshpet-settings .dshpet-status[data-tone="enabled"]{
  --dshpet-tone:var(--dsw-alias-state-success-primary,#1a7f37)}
.dshpet-settings .dshpet-status[data-tone="warn"]{
  --dshpet-tone:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dshpet-settings .dshpet-status[data-tone="danger"]{
  --dshpet-tone:var(--dsw-alias-state-error-primary,#ec1313)}
/* Read-only value display: a binding shows its value until you choose Edit.

   32px like every other control. At 28px next to a 32px Edit button in a
   bottom-aligned row, the two boxes agreed only at their bottom edge, leaving
   the value's text sitting ~2px below its own button — visible on every
   stored field ("运行参数", "预设", "默认上下文策略"). */
.dshpet-readonly{display:inline-flex;align-items:center;box-sizing:border-box;
  height:32px;padding:0 10px;font-size:14px;line-height:22px;
  color:var(--dsw-alias-label-primary,#1f2329);
  background:var(--dsw-alias-bg-module-platform,#0000000a);border-radius:8px}
.dshpet-readonly[data-empty="true"]{color:var(--dsw-alias-label-tertiary,#8f959e)}

/* Ordered onboarding / allowlist / route lists. These carried no styles at
   all, so they rendered with the browser's default disc markers and 40px
   indent — the single most out-of-place thing on the Channel tab. */
.dshpet-settings .dshpet-list{display:flex;flex-direction:column;gap:6px;
  margin:0;padding:0;list-style:none}
.dshpet-settings .dshpet-item{display:flex;align-items:center;gap:10px;
  flex-wrap:wrap;min-width:0;padding:8px 12px;border-radius:12px;
  border:.5px solid var(--dsw-alias-border-l4,#0000001a);
  font:400 13px/20px var(--dsw-font-family,inherit)}
/* A completed onboarding step is quieter than an outstanding one: the point
   of the list is to show what is LEFT. */
.dshpet-settings .dshpet-item[data-complete="true"]{
  color:var(--dsw-alias-label-tertiary,#8f959e);border-color:transparent;
  background:var(--dsw-alias-bg-module-platform,#0000000a)}
/* The mark is a glyph swap (○ → ✓) between two very different shapes, so it
   is given a fixed box and centred inside it. Left to flow, the two glyphs'
   unequal heights moved the step's text baseline as steps completed. */
.dshpet-settings .dshpet-step-mark{flex:none;display:inline-flex;
  align-items:center;justify-content:center;width:16px;height:20px;
  font-size:12px;line-height:1}
.dshpet-settings .dshpet-item[data-complete="true"] .dshpet-step-mark{
  color:var(--dsw-alias-state-success-primary,#1a7f37)}
.dshpet-settings .dshpet-item-text{flex:1;min-width:0}
.dshpet-settings .dshpet-item .dshpet-action{margin-left:auto}
/* Definition list for bot identity and connection facts. Bare "dl" markup
   inherited the UA's 40px margin and stacked term over value. */
/* Both columns share one line-height. A "dd" here often holds an IdentityChip
   — a padded button, not text — and baseline-aligning a padded box against a
   bare term put the two columns on different lines. Centring each row on a
   common 22px line keeps them level whether the value is text or a control. */
.dshpet-settings .dshpet-kv{display:grid;grid-template-columns:auto 1fr;
  gap:8px 16px;margin:0;align-items:center}
.dshpet-settings .dshpet-kv dt{font-size:13px;line-height:22px;
  color:var(--dsw-alias-label-secondary,#61666b)}
.dshpet-settings .dshpet-kv dd{margin:0;min-width:0;font-size:13px;line-height:22px;
  color:var(--dsw-alias-label-primary,#0f1115)}

/* Environment rows: name + injected name, masked value, actions. The grid keeps
   the three columns aligned across both scopes and the effective view. */
.dshpet-settings .dshpet-env-row{display:grid;
  grid-template-columns:minmax(140px,1fr) minmax(160px,1.4fr) auto;
  gap:12px;align-items:center;padding:10px 12px;border-radius:12px;
  border:.5px solid var(--dsw-alias-border-l4,#0000001a);
  background:var(--dsw-alias-bg-layer-1,#fff)}
.dshpet-env-key{display:flex;flex-direction:column;gap:2px;min-width:0}
/* The name carries an inline badge ("覆盖全局" / "已被覆盖"), so it is a flex
   row on a fixed 20px line: as a bare block it inherited a normal
   line-height from a monospace font and the badge — an inline-block with its
   own padding — grew the line, pushing the injected name underneath out of
   step with the value column beside it. */
.dshpet-env-name{display:flex;align-items:center;gap:6px;min-width:0;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
  line-height:20px;color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-env-inject{font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,#8f959e);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dshpet-env-value{display:flex;align-items:center;gap:8px;min-width:0}
.dshpet-env-secret{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
  line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-primary,#1f2329)}
/* Centred by flex rather than by a hand-tuned line-height: 22px of box with a
   20px line and a .5px border left the label a fraction of a pixel high, and
   "box-sizing" was never stated so the border grew the box past its own
   declared height. */
.dshpet-settings .dshpet-reveal{flex:none;box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;
  height:22px;padding:0 8px;font-size:11px;line-height:1;
  border-radius:11px;cursor:pointer;
  border:.5px solid var(--dsw-alias-border-l4,#0000001a);
  background:0 0;color:var(--dsw-alias-label-secondary,#61666b)}
.dshpet-settings .dshpet-reveal:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
/* Both badges are flex items of .dshpet-env-name now, so they align by that
   row's cross axis instead of by a hand-set line-height, and the margin that
   used to separate them is the row's gap. */
.dshpet-badge-override{display:inline-flex;align-items:center;flex:none;
  box-sizing:border-box;height:18px;padding:0 8px;
  font-size:11px;font-weight:500;line-height:1;border-radius:999px;white-space:nowrap;
  background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}
.dshpet-badge-shadowed{display:inline-flex;align-items:center;flex:none;
  box-sizing:border-box;height:18px;padding:0 8px;
  font-size:11px;line-height:1;border-radius:999px;white-space:nowrap;
  background:var(--dsw-alias-bg-module-platform,#0000000a);
  color:var(--dsw-alias-label-tertiary,#8f959e)}
/* A shadowed global entry stays visible but reads as inert, so the override is
   obvious without hiding what it replaced. */
.dshpet-row-shadowed .dshpet-env-name,
.dshpet-row-shadowed .dshpet-env-secret{opacity:.55;text-decoration:line-through}

/* Diagnostics rows: label + value pairs instead of a raw JSON dump. */
.dshpet-facts{display:flex;flex-direction:column;gap:8px;margin:0}
/* Label/value pair. Both columns declare the SAME 22px line so their text
   agrees; with that in place, centring and baseline coincide for ordinary
   text, and centring additionally holds when the value is a CONTROL rather
   than text. Baseline did not: a 20px connection-state pill against the 22px
   label sat 2px low (measured in Chrome via CDP, not reasoned about). */
.dshpet-fact{display:flex;gap:12px;align-items:center}
.dshpet-fact-key{flex:none;min-width:132px;font-size:13px;line-height:22px;
  color:var(--dsw-alias-label-secondary,#646a73)}
.dshpet-fact-value{min-width:0;font-size:14px;line-height:22px;
  word-break:break-all;color:var(--dsw-alias-label-primary,#1f2329)}
.dshpet-fact-value code{font-size:13px}
/* A value carrying a pill opts in explicitly rather than through ":has()",
   whose support this stylesheet cannot assume. An inline-flex chip on a
   baseline-aligned row contributes its own margin edge as the baseline, which
   dropped "连接状态" out of line with its label. */
.dshpet-fact-value[data-chip="true"]{display:flex;align-items:center;gap:6px}
/* In-app Host directory browser, used where no OS picker exists. */
.dshpet-browser{display:flex;flex-direction:column;gap:8px;padding:12px;
  border:.5px solid var(--dsw-alias-border-l4,#0000001a);border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff)}
.dshpet-crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.dshpet-browser-list{display:flex;flex-direction:column;gap:2px;
  max-height:220px;overflow:auto}
/* Two-level selector, matching the settings action rule that centers its
   label. A single-class rule loses on specificity, which is why the entries
   rendered centered instead of as a left-aligned list. */
.dshpet-settings .dshpet-browser-entry{justify-content:flex-start;text-align:left;
  width:100%;background:0 0;border:0;height:32px;padding:0 8px;border-radius:8px;
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
.dshpet-settings .dshpet-action-primary{border-color:transparent;
  background:var(--dsw-alias-button-info-fill,#0f1115);
  color:#fff}
.dshpet-settings .dshpet-action-primary:hover:not(:disabled){
  background:var(--dsw-alias-button-info-hover,#2a2d33)}
/* Destructive actions need a visual warning: Remove sat identical to Enable. */
.dshpet-settings .dshpet-action-danger{
  color:var(--dsw-alias-state-error-primary,#ec1313)}
.dshpet-settings .dshpet-action-danger:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover-danger,#ec13131a)}
.dshpet-settings .dshpet-action-sm{height:28px;padding:0 10px;border-radius:14px;
  font:var(--dsw-font-xxs-12,400 12px/18px inherit)}
.dshpet-settings .dshpet-actions{display:flex;gap:8px;flex-wrap:wrap;
  align-items:center;margin-top:0}
/* Inline code, for paths and identifiers. */
/* Inline code, for paths and identifiers.

   Plain "inline", NOT "inline-flex". An inline-flex box takes its baseline
   from its own flex line rather than from the text it sits in, so every
   inline path ("dsh web", the Skill source path, the injected variable name)
   rode above the sentence around it. Padding is horizontal only for the same
   reason: vertical padding on an inline box does not grow the line, so it
   would overlap the lines above and below instead of spacing them. */
.dshpet-code{display:inline;padding:1px 5px;border-radius:6px;
  font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:.875em;
  background:var(--dsw-alias-bg-module-platform,#0000000a)}
/* Installed-Skill row heading. */
.dshpet-settings .dshpet-task-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshpet-settings .dshpet-task-name{
  font:var(--dsw-font-s-strong-14,500 14px/22px inherit);
  color:var(--dsw-alias-label-primary,#0f1115)}
`
