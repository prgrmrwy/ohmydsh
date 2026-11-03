/**
 * One scoped stylesheet for the settings section, the speed control and the
 * sidebar usage card. Colours come only from `--dsw-alias-*` theme tokens (they
 * flip under the shell's dark theme); geometry follows the official chrome.
 */
import { birdSvg } from './bird-svg.js'

const birdMask = `-webkit-mask-image:url("data:image/svg+xml,${encodeURIComponent(birdSvg)}");mask-image:url("data:image/svg+xml,${encodeURIComponent(birdSvg)}");-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain`

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
.dmg-fill{height:100%;background:var(--dsw-alias-state-business-primary);border-radius:3px}
.dmg-fill[data-level=warn]{background:var(--dsw-alias-state-warn-primary)}
.dmg-fill[data-level=high]{background:var(--dsw-alias-state-error-primary)}
.dmg-models{display:flex;flex-direction:column}
.dmg-model{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dmg-model label{display:flex;align-items:center;gap:6px;min-width:0;flex:1}
.dmg-model label>span{overflow-wrap:anywhere}
.dmg-model code{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dmg-info{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:default}
.dmg-lines{display:flex;flex-direction:column;gap:8px}
.dmg-line{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:6px 8px 6px 6px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1)}
.dmg-line-head{display:flex;align-items:center;gap:8px;min-width:0}
.dmg-line-toggle{flex:1;display:flex;align-items:center;gap:8px;min-width:0;margin:0;padding:2px 4px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dmg-line-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmg-line-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dmg-chevron{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);transition:transform 100ms ease}
.dmg-line[data-expanded=true] .dmg-chevron{transform:rotate(90deg)}
.dmg-line-index{font-weight:500;white-space:nowrap}
.dmg-line-title{color:var(--dsw-alias-label-tertiary);font-size:12px;overflow-wrap:anywhere;min-width:0;flex:1}
.dmg-active{width:4px;height:4px;flex:none;background:var(--dmg-active,#22c55e)}
.dmg-line-actions{display:flex;gap:2px;flex:none;margin-left:auto}
.dmg-icon-button{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dmg-icon-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dmg-icon-button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dmg-icon-button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dmg-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}
.dmg-latency{display:inline-flex;align-items:center;gap:4px;flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dmg-latency[data-latency-state=failed]{color:var(--dsw-alias-label-dimmed)}
.dmg-bars{display:inline-flex;align-items:flex-end;gap:2px;height:11px}
.dmg-bars i{display:block;width:3px;border-radius:1px;background:var(--dsw-alias-border-l3);height:4px}
.dmg-bars i:nth-child(2){height:6px}
.dmg-bars i:nth-child(3){height:8px}
.dmg-bars i:nth-child(4){height:10px}
.dmg-bars i[data-on=true]{background:var(--dsw-alias-state-success-primary)}
.dmg-bars[data-level="2"] i[data-on=true],.dmg-bars[data-level="1"] i[data-on=true]{background:var(--dsw-alias-state-warn-primary)}
.dmg-bars[data-level="0"] i[data-on=true]{background:var(--dsw-alias-label-dimmed)}
.dmg-latency-text{white-space:nowrap;min-width:0}
.dmg-unset{padding:0 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap}
.dmg-check{display:flex;flex-direction:column;gap:6px;padding-top:4px;border-top:.5px dashed var(--dsw-alias-border-l2)}
.dmg-check-line{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dmg-check-line[data-check-kind=ok]{color:var(--dsw-alias-label-primary)}
.dmg-check-models>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dmg-check-models p{margin:4px 0 0;overflow-wrap:anywhere}
.dmg-line-body{display:flex;flex-direction:column;gap:10px;padding:2px 4px 2px 10px;border-left:.5px solid var(--dsw-alias-border-l2)}
.dmg-speed{position:relative;display:inline-flex}
.dmg-speed-trigger{border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:2px 8px;cursor:pointer;white-space:nowrap}
.dmg-speed-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmg-speed-menu{position:absolute;bottom:100%;right:0;margin-bottom:4px;min-width:180px;padding:4px;z-index:20;display:flex;flex-direction:column;gap:2px;border-radius:16px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 28px var(--dsw-alias-bg-mask-1,#0003)}
.dmg-speed-item{display:flex;align-items:flex-start;gap:6px;width:100%;border:none;border-radius:8px;background:transparent;padding:6px 8px;cursor:pointer;font:inherit;text-align:left;color:var(--dsw-alias-label-primary)}
.dmg-speed-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmg-speed-item>span:first-child{width:14px;flex:none;font-size:12px}
.dmg-speed-item small{display:block;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}

/* ── sidebar usage card (sidebar.footer.action) ─────────────────────────── */
.dmg-sidebar{flex:1;min-width:0;display:flex}
.dmg-sidebar-slot{position:relative;flex:1;min-width:0;display:flex;flex-direction:column}
.dmg-sidebar-card{position:relative;margin:0 2px 6px;padding:6px 9px 4px;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 1px 2px #0000000f,0 4px 14px #0000000d;display:flex;flex-direction:column;min-width:0}
[data-ds-dark-theme] .dmg-sidebar-card{box-shadow:0 1px 2px #00000033,0 4px 14px #0000002e}
.dmg-sidebar-head{display:flex;align-items:center;gap:5px;height:22px;flex:none;min-width:0}
.dmg-sidebar-bird{flex:none;width:15px;height:15px;background-color:var(--dsw-alias-label-secondary);${birdMask}}
.dmg-sidebar-title{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap}
.dmg-sidebar-fresh{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dmg-sidebar-icon{width:18px;height:18px;flex:none;border:0;border-radius:5px;padding:0;background:transparent;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.dmg-sidebar-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dmg-sidebar-icon:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dmg-sidebar-icon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dmg-sidebar-icon svg{width:12px;height:12px}
.dmg-sidebar-body{max-height:145px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l3) transparent;margin-top:2px}
.dmg-sidebar-body.is-scroll{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 6px),rgba(0,0,0,.6));mask-image:linear-gradient(to bottom,#000 calc(100% - 6px),rgba(0,0,0,.6))}
.dmg-sidebar-body::-webkit-scrollbar{width:5px}
.dmg-sidebar-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3);border-radius:3px}
.dmg-sidebar-row{padding:2px 0 3px;min-width:0}
.dmg-sidebar-row-line{display:flex;align-items:baseline;gap:6px;min-width:0}
.dmg-sidebar-name{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dmg-sidebar-window{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dmg-sidebar-pct{flex:none;min-width:36px;text-align:right;font-size:11.5px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dmg-sidebar-pct[data-level=warn]{color:var(--dsw-alias-state-warn-label)}
.dmg-sidebar-pct[data-level=high]{color:var(--dsw-alias-state-error-primary)}
.dmg-sidebar-bar{height:3px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-border-l2);margin-top:3px}
.dmg-sidebar-bar>i{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
.dmg-sidebar-bar>i[data-level=warn]{background:var(--dsw-alias-state-warn-primary)}
.dmg-sidebar-bar>i[data-level=high]{background:var(--dsw-alias-state-error-primary)}
.dmg-sidebar-row-error{margin:2px 0 0;font-size:10.5px;line-height:15px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.dmg-sidebar-more{flex:none;height:16px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dmg-sidebar-more:hover{color:var(--dsw-alias-label-secondary)}
.dmg-sidebar-more:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px;border-radius:6px}
.dmg-sidebar-more svg{width:12px;height:12px}
.dmg-sidebar-status{margin:2px 0 4px;font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dmg-sidebar-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin:4px 0 6px;flex:none}
.dmg-sidebar-expanded{position:absolute;left:0;right:0;bottom:0;z-index:6;max-height:min(72vh,600px);overflow-y:auto;overscroll-behavior:contain;background:var(--dsw-alias-bg-layer-2);border:0;border-radius:12px;box-shadow:0 6px 24px #00000029,0 2px 6px #00000014;padding:6px 9px}
[data-ds-dark-theme] .dmg-sidebar-expanded{box-shadow:0 8px 30px #00000066,0 2px 8px #00000040}
.dmg-sidebar-expanded::-webkit-scrollbar{width:5px}
.dmg-sidebar-expanded::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3);border-radius:3px}
.dmg-sidebar-prov+ .dmg-sidebar-prov{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:6px;padding-top:6px}
.dmg-sidebar-prov-head{display:block;min-width:0}
.dmg-sidebar-prov-head strong{display:block;font-weight:500;font-size:12.5px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dmg-sidebar-meta{display:block;margin-top:1px;font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dmg-sidebar-win{margin-top:5px}
.dmg-sidebar-win-line{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:10.5px}
.dmg-sidebar-win-name{min-width:0;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dmg-sidebar-reset{margin-left:auto;flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dmg-sidebar-foot{margin-top:4px;display:flex;flex-wrap:wrap;gap:2px 8px;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dmg-sidebar-foot b{font-weight:400;color:var(--dsw-alias-label-secondary)}
.dmg-sidebar-error{margin:3px 0 0;font-size:10.5px;line-height:15px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.dmg-sidebar-rail{width:36px;height:36px;flex:none;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.dmg-sidebar-rail:hover,.dmg-sidebar-rail[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmg-sidebar-rail:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dmg-sidebar-rail .dmg-sidebar-bird{width:20px;height:20px}
.dmg-sidebar-popover{position:fixed;z-index:1100;box-sizing:border-box;max-height:min(62vh,560px);overflow-y:auto;overscroll-behavior:contain;background:var(--dsw-specific-menu);border:0;border-radius:16px;box-shadow:0 6px 24px #00000033,0 2px 8px #0000001a;padding:12px 14px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);backdrop-filter:blur(20px)}
[data-ds-dark-theme] .dmg-sidebar-popover{box-shadow:0 10px 34px #00000080,0 2px 10px #0000004d}
.dmg-sidebar-popover::-webkit-scrollbar{width:8px}
.dmg-sidebar-popover::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3);border-radius:4px}
/* settings page: the sidebar preference switch */
.dmg-switch-row{display:flex;align-items:flex-start;gap:12px;padding-top:2px}
.dmg-switch-row>span{flex:1;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dmg-switch{flex:none;width:36px;height:20px;margin-top:1px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);display:inline-flex;align-items:center;cursor:pointer}
.dmg-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary);justify-content:flex-end}
.dmg-switch:disabled{cursor:default;opacity:.6}
.dmg-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dmg-switch>i{display:block;width:16px;height:16px;border-radius:999px;background:#fff}
.dmg-switch-hint{margin:6px 0 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
`
