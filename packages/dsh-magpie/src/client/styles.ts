/**
 * One scoped stylesheet for the settings section and the speed control.
 * Colours come only from `--dsw-alias-*` theme tokens (they flip under the
 * shell's dark theme); geometry follows the official settings section.
 */
export const settingsCss = `
.dmg-settings{display:flex;flex-direction:column;gap:16px;max-width:620px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);min-width:0}
.dmg-settings h3{margin:0;font-size:14px;line-height:22px;font-weight:500}
.dmg-settings h4{margin:0;font-size:13px;line-height:20px;font-weight:500}
.dmg-settings p{margin:0}
.dmg-intro,.dmg-hint,.dmg-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;overflow-wrap:anywhere}
.dmg-panel{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4));border-radius:16px;background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2))}
.dmg-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dmg-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dmg-field{display:flex;flex-direction:column;gap:4px}
.dmg-field>span{color:var(--dsw-alias-label-secondary);font-size:12px}
.dmg-input,.dmg-select{box-sizing:border-box;min-width:0;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.dmg-select{height:26px;padding:0 6px;font-size:12px}
.dmg-input:focus-visible,.dmg-select:focus-visible,.dmg-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dmg-button{height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dmg-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmg-button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dmg-error{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}
.dmg-ok{color:var(--dsw-alias-label-secondary);font-size:12px}
.dmg-usage{display:flex;flex-direction:column;gap:6px}
.dmg-advanced>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}
.dmg-advanced-body{display:flex;flex-direction:column;gap:10px;margin-top:10px;padding-left:10px;border-left:.5px solid var(--dsw-alias-border-l2)}
.dmg-cards{display:flex;flex-direction:column;gap:8px}
.dmg-card{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px}
.dmg-card-title{display:flex;align-items:center;gap:8px;min-width:0}
.dmg-card-title>strong{font-weight:500;overflow-wrap:anywhere}
.dmg-card-title>.dmg-button{margin-left:auto}
.dmg-facts{display:flex;flex-wrap:wrap;gap:2px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dmg-facts>span>b{font-weight:400;color:var(--dsw-alias-label-secondary)}
.dmg-window{display:flex;flex-direction:column;gap:3px}
.dmg-window-line{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dmg-window-line time{color:var(--dsw-alias-label-tertiary)}
.dmg-track{height:6px;border-radius:3px;overflow:hidden;background:var(--dsw-alias-border-l2)}
.dmg-fill{height:100%;background:var(--dsw-alias-state-business-primary)}
.dmg-fill[data-level=warn]{background:var(--dsw-alias-state-warn-primary)}
.dmg-fill[data-level=high]{background:var(--dsw-alias-state-error-primary)}
.dmg-models{display:flex;flex-direction:column}
.dmg-model{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dmg-model label{display:flex;align-items:center;gap:6px;min-width:0;flex:1}
.dmg-model label>span{overflow-wrap:anywhere}
.dmg-model code{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dmg-speed{position:relative;display:inline-flex}
.dmg-speed-trigger{border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:2px 8px;cursor:pointer;white-space:nowrap}
.dmg-speed-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmg-speed-menu{position:absolute;bottom:100%;right:0;margin-bottom:4px;min-width:180px;padding:4px;z-index:20;display:flex;flex-direction:column;gap:2px;border-radius:16px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 28px var(--dsw-alias-bg-mask-1,#0003)}
.dmg-speed-item{display:flex;align-items:flex-start;gap:6px;width:100%;border:none;border-radius:8px;background:transparent;padding:6px 8px;cursor:pointer;font:inherit;text-align:left;color:var(--dsw-alias-label-primary)}
.dmg-speed-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmg-speed-item>span:first-child{width:14px;flex:none;font-size:12px}
.dmg-speed-item small{display:block;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
`
