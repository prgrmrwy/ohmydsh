/**
 * Styles for the Memory settings page and its navigation glyph.
 *
 * The page lives inside the host's settings panel, so the host owns the theme:
 * every colour is a role mapped onto an official `--dsw-alias-*` token, and the
 * page contributes structure, scale and one memorable device instead of a
 * palette of its own. No webfonts, no images, no network.
 *
 * The memorable device is the spine: the vertical rule a workspace's entries hang
 * from, which is the actual shape of the data (one workspace, several entries).
 * Entries are collapsed to role + name + count and open on demand, so the page
 * answers "how many entries, how much in each" before it answers "where does
 * this one publish".
 *
 * Own class names (`dshmx-*`) only, injected once with the plugin marker. The
 * nav-glyph rules are scoped to our own marker attribute, so they cannot reach
 * another plugin's row.
 *
 * @module dsh-memex/client/styles
 */

/** Attribute marking our own row in the settings navigation. */
export const NAV_MARKER = 'data-dsh-memex-settings-nav'

/**
 * A 16px outline book, drawn as a mask so it inherits `currentColor` like the
 * official glyphs (no emoji font, no image asset, no network access).
 */
const BOOK_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M2.4 2.6h4.1a1.6 1.6 0 0 1 1.5 1.1 1.6 1.6 0 0 1 1.5-1.1h4.1v9.4H9.5a1.5 1.5 0 0 0-1.5 1.3 1.5 1.5 0 0 0-1.5-1.3H2.4z"/>'
  + '</svg>',
)}")`

/**
 * The page's whole stylesheet.
 *
 * Type scale, in three steps rather than six sizes: 17/600 for a workspace
 * title, 15/500 for its primary entry's name (14/400 when the entry is an
 * additional one), and 11-12px for everything that qualifies them — counts,
 * labels, prose. Identifiers — paths and remote URLs — are the only monospace
 * text: they are machine strings where a misread character costs real debugging
 * time. Emphasis is spent in one place: the filled save button.
 */
export const MEMEX_CSS = `
.dshmx-root{
  --dshmx-ink:var(--dsw-alias-label-primary,#1f2329);
  --dshmx-ink-2:var(--dsw-alias-label-secondary,#646a73);
  --dshmx-ink-3:var(--dsw-alias-label-tertiary,#8f959e);
  --dshmx-rule:var(--dsw-alias-border-l2,rgba(0,0,0,.1));
  --dshmx-rule-weak:var(--dsw-alias-border-l1,rgba(0,0,0,.06));
  --dshmx-rule-strong:var(--dsw-alias-border-l3,rgba(0,0,0,.16));
  --dshmx-dimmed:var(--dsw-alias-label-dimmed,rgba(0,0,0,.28));
  --dshmx-layer:var(--dsw-alias-bg-layer-2,#fff);
  --dshmx-hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));
  --dshmx-accent:var(--dsw-alias-brand-primary,#4d6bfe);
  --dshmx-danger:var(--dsw-alias-state-error-primary,#c0392b);
  --dshmx-success:var(--dsw-alias-state-success-primary,#2ba471);
  --dshmx-warn:var(--dsw-alias-state-warn-primary,#e8a33d);
  --dshmx-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  display:flex;flex-direction:column;gap:16px;
  color:var(--dshmx-ink);
  font-size:13px;line-height:1.5;
}
/* Prose says something to the reader; it is set apart from the data below it by
   size and colour, and bounded so a hint never runs the width of the panel. */
.dshmx-lede{margin:0;max-width:62ch;font-size:12px;line-height:1.6;color:var(--dshmx-ink-2)}
.dshmx-bar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dshmx-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em}

/* Shelf: one rule per workspace, and that rule is stronger than the ones inside
   a block — otherwise a workspace boundary and an entry boundary look alike and
   the page reads as one flat list. */
.dshmx-shelf{display:flex;flex-direction:column}
.dshmx-lib{border-top:1px solid var(--dshmx-rule-strong);padding:18px 0 16px}
.dshmx-lib:first-child{border-top:0;padding-top:2px}
.dshmx-lib-head{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin-bottom:6px}
/* Three steps carry the page's hierarchy, and nothing else does: the workspace
   title (17/600) is the block, an entry name (15/500, or 14/400 when it is an
   additional entry) is a row inside it, and everything qualified is 11-12px.
   The title used to be 15/500 as well, which made the two levels identical. */
.dshmx-ws-title{font-size:17px;font-weight:600;letter-spacing:-.02em;color:var(--dshmx-ink)}
.dshmx-ws-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dshmx-ink-3)}
.dshmx-lib-head>.dshmx-count{margin-left:auto}
.dshmx-count{flex:none;font-size:11px;color:var(--dshmx-ink-3);font-variant-numeric:tabular-nums}
/* A field that shares a line with its own affordance must flex, not overflow:
   the base rule sizes fields to the full column. */
.dshmx-lib-head>.dshmx-field,.dshmx-fieldrow>.dshmx-field,.dshmx-value>.dshmx-field{flex:1;width:auto;min-width:0}
.dshmx-fieldrow{display:flex;align-items:center;gap:8px;min-width:0;position:relative}
/* Eyebrow: only used where a block is *not* a workspace, so it distinguishes
   rather than repeats. */
.dshmx-part-label{font-size:11px;color:var(--dshmx-ink-3)}
/* Editable path list of a block that has no workspace behind it. */
.dshmx-ws{display:flex;flex-direction:column;gap:4px;min-width:0}

/* Quiet fields: they read as text, and only become fields on hover/focus. */
.dshmx-field{
  font:inherit;color:inherit;background:transparent;border:0;border-radius:6px;
  padding:2px 6px;margin-left:-6px;width:calc(100% + 12px);min-width:0;
  transition:background-color .12s ease;
}
.dshmx-field::placeholder{color:var(--dshmx-ink-3)}
.dshmx-field:hover{background:var(--dshmx-hover)}
.dshmx-field:focus{outline:2px solid var(--dshmx-accent);outline-offset:-1px;background:var(--dshmx-hover)}
.dshmx-name{font-size:15px;font-weight:500;letter-spacing:-.01em}
.dshmx-ident{font-family:var(--dshmx-mono);font-size:12px}

/* One weak button treatment for every action on the page.
   A bare text label did not read as clickable in use, so the border carries the
   affordance — at the same weight as every other ruled line here, which keeps
   the page quiet while making the controls findable. Every action uses it, with
   no exceptions: a mix of bordered and un-bordered labels is what leaves a
   reader unsure about what can be clicked. */
.dshmx-act{
  font:inherit;font-size:12px;line-height:18px;color:var(--dshmx-ink-2);
  background:transparent;border:1px solid var(--dshmx-rule);border-radius:6px;
  padding:1px 8px;margin-left:0;cursor:pointer;text-align:left;
  white-space:nowrap;flex:none;
  transition:background-color .12s ease,border-color .12s ease,color .12s ease;
}
.dshmx-act:hover:not(:disabled){color:var(--dshmx-ink);border-color:var(--dshmx-rule-strong);background:var(--dshmx-hover)}
.dshmx-act:active:not(:disabled){background:var(--dshmx-hover)}
.dshmx-act:focus-visible{outline:2px solid var(--dshmx-accent);outline-offset:1px}
.dshmx-act:disabled{color:var(--dshmx-dimmed);border-color:var(--dshmx-rule-weak);cursor:default}
/* Buttons are inline by construction now; the class stays because every call
   site says so, and it is where the no-wrap rule used to live. */
.dshmx-act-inline{}
.dshmx-primary{
  font:inherit;font-size:12px;font-weight:500;
  color:var(--dsw-alias-label-primary-foreground,#fff);
  background:var(--dsw-alias-button-primary-fill,#4d6bfe);
  border:0;border-radius:6px;padding:5px 12px;cursor:pointer;
}
.dshmx-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#3f59d8)}
.dshmx-primary:focus-visible{outline:2px solid var(--dshmx-accent);outline-offset:2px}
.dshmx-primary:disabled{opacity:.4;cursor:default}

/* Facts read as a labelled list, never as a middot-joined string. */
.dshmx-facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 12px;margin:0;font-size:12px}
.dshmx-facts dt{font-size:11px;color:var(--dshmx-ink-3)}
.dshmx-facts dd{margin:0;min-width:0;word-break:break-word;color:var(--dshmx-ink-2)}
.dshmx-facts dd.dshmx-ident{color:var(--dshmx-ink)}
/* A value and its copy affordance share one line, so the button never floats
   away from what it copies. */
.dshmx-value{display:flex;align-items:center;gap:8px;min-width:0}
/* A remote URL is one token with no spaces: break it anywhere rather than let it
   push its own copy button onto a second line. */
.dshmx-value>span{min-width:0;word-break:break-word}
.dshmx-url{overflow-wrap:anywhere}

.dshmx-note{font-size:11px;color:var(--dshmx-ink-3)}
/* One entry inside a workspace; the workspace is the block above. */
/* The spine: one rule carries every entry of a workspace, so "these hang from
   that workspace" is visible rather than implied. It is the page's one structural
   device, and it is what the expanded body indents against. */
.dshmx-entries{display:flex;flex-direction:column;border-left:1px solid var(--dshmx-rule);
  padding-left:14px;margin:2px 0 0 2px}
.dshmx-entry{display:flex;flex-direction:column;gap:6px;padding:6px 0}
.dshmx-entry+.dshmx-entry{border-top:1px dashed var(--dshmx-rule-weak)}
/* The collapsed line is the comparable one: role, name, count. Anything that
   needs its own explanation lives in the expanded body below it. */
.dshmx-entry-line{display:flex;align-items:center;gap:8px;min-width:0;min-height:22px}
.dshmx-entry-line>.dshmx-field{flex:1;width:auto;min-width:0}
.dshmx-name-text{flex:1;min-width:0;font-size:15px;font-weight:500;letter-spacing:-.01em;
  color:var(--dshmx-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* An additional entry is optional by definition — only a named call uses it — so
   it is one step quieter than the primary it sits under. */
.dshmx-entry-additional .dshmx-name-text{font-size:14px;font-weight:400;color:var(--dshmx-ink-2)}
.dshmx-entry-body{display:flex;flex-direction:column;gap:8px;min-width:0;
  padding-left:22px}
.dshmx-entry-body>.dshmx-note{margin:0;max-width:56ch}
.dshmx-prose{font-size:12px;line-height:1.6;color:var(--dshmx-ink-2)}
/* The disclosure is the one square affordance: it says "there is more here"
   without competing with the name it sits next to. */
.dshmx-disclose{flex:none;display:flex;align-items:center;justify-content:center;
  width:22px;height:22px;padding:0;font-size:10px;line-height:1;color:var(--dshmx-ink-3)}
.dshmx-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:16px;
  color:var(--dshmx-ink-2);cursor:pointer;white-space:nowrap}
.dshmx-toggle input{margin:0;width:14px;height:14px;accent-color:var(--dshmx-accent)}
.dshmx-attach{display:inline-flex;align-items:center;gap:8px;min-width:0}
/* The add-entry affordance belongs to the same spine as the entries it extends. */
.dshmx-lib>.dshmx-actions{padding-left:14px}
.dshmx-attach>.dshmx-field{flex:1;width:auto;min-width:0;max-width:32ch;
  border:1px solid var(--dshmx-rule);border-radius:6px;padding:1px 6px;margin-left:0}
/* Role badge: the only place a filled chip appears, because "which one is the
   default target" is the one thing a group of entries must say at a glance. */
.dshmx-role{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:4px;
  border:1px solid var(--dshmx-rule);color:var(--dshmx-ink-3)}
.dshmx-role-primary{border-color:transparent;background:var(--dshmx-ink);color:var(--dshmx-layer)}
.dshmx-actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.dshmx-empty{color:var(--dshmx-ink-3)}
/* One banner structure; the state rides on the rule and the title colour, so a
   banner never invents a background the theme does not define. */
.dshmx-banner{
  background:var(--dshmx-layer);border-left:2px solid var(--dshmx-rule);
  border-radius:0 6px 6px 0;padding:8px 10px;font-size:12px;
}
.dshmx-banner .dshmx-note{color:var(--dshmx-ink-2)}
.dshmx-banner-error{border-left-color:var(--dshmx-danger);color:var(--dshmx-danger)}
.dshmx-banner-ok{border-left-color:var(--dshmx-success);color:var(--dshmx-success)}
.dshmx-banner-warn{border-left-color:var(--dshmx-warn);color:var(--dshmx-ink)}
.dshmx-footer{display:flex;align-items:center;gap:12px;border-top:1px solid var(--dshmx-rule-strong);padding-top:14px}
.dshmx-footer .dshmx-note{flex:1}
.dshmx-group{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dshmx-rule-strong);padding-top:14px}
/* A section heading, not a footnote: same rule weight as a workspace block. */
.dshmx-group-title{font-size:12px;font-weight:500;color:var(--dshmx-ink)}
.dshmx-line{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dshmx-probe{display:flex;align-items:center;gap:10px}
.dshmx-probe .dshmx-field{flex:1;width:auto;margin-left:0;padding-left:0;border-radius:0;border-bottom:1px solid var(--dshmx-rule)}
.dshmx-probe .dshmx-field:hover{background:transparent}
.dshmx-probe .dshmx-field:focus{outline:0;background:transparent;border-bottom-color:var(--dshmx-accent)}
@media (prefers-reduced-motion:reduce){
  .dshmx-field,.dshmx-act{transition:none}
}
[${NAV_MARKER}]>svg:first-child{display:none}
[${NAV_MARKER}]::before{content:'';flex:none;width:16px;height:16px;background-color:currentColor;
  -webkit-mask:${BOOK_MASK} center/16px 16px no-repeat;mask:${BOOK_MASK} center/16px 16px no-repeat}
`
