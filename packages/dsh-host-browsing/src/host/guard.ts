/**
 * Index guard (design D7 step 5), installed with the official `webServer.tapIndex`.
 *
 * Cross-document back/forward inside the tab iframe makes the browser GET the
 * unprefixed URL; when that lands on DSH's index, DSH must not boot inside the
 * iframe. The guard runs before any DSH script (the tap runs after all structured
 * index rows and inserts right after the first `<head>`; the official frontend
 * adds only a `<base>` ahead of it, which executes nothing):
 *
 *  - not inside an iframe carrying `data-dshls` → does nothing (top-level DSH and
 *    ordinary iframes boot normally);
 *  - otherwise `window.stop()`, look the current navigation entry up in the identity
 *    table the injected script keeps in native sessionStorage, and `location.replace`
 *    to the root-absolute proxy URL (unaffected by `<base>`);
 *  - no / invalid identity → report `dshls:identity-unavailable` (reason exactly
 *    `no-identity`; any other reason for a real failure) and guess nothing. Navigating
 *    away (about:blank) is the tab's job, not the guard's.
 */
import { ENTRIES_KEY_PREFIX, FRAME_ATTR, ROUTE_PREFIX } from '../contract.js'

/** Guard source (plain ES5-style, no dependencies, no `</script`). */
export const GUARD_SCRIPT = `(function () {
  var frame;
  try { frame = window.frameElement; } catch (e) { return; }
  if (!frame || !frame.hasAttribute(${JSON.stringify(FRAME_ATTR)})) return;
  var frameId = frame.getAttribute(${JSON.stringify(FRAME_ATTR)});
  window.stop();
  var report = function (reason) {
    try { parent.postMessage({ type: 'dshls:identity-unavailable', reason: reason }, location.origin); } catch (e) {}
  };
  try {
    var raw = sessionStorage.getItem(${JSON.stringify(ENTRIES_KEY_PREFIX)} + frameId);
    var table = raw === null ? null : JSON.parse(raw);
    var entry = table !== null && typeof table === 'object' ? table[navigation.currentEntry.key] : undefined;
    var valid = entry !== null && typeof entry === 'object'
      && (entry.fam === 'p' || entry.fam === 'p6')
      && typeof entry.port === 'string' && /^[1-9][0-9]{0,4}$/.test(entry.port) && Number(entry.port) <= 65535
      && typeof entry.rest === 'string' && entry.rest.charAt(0) === '/';
    if (!valid) { report('no-identity'); return; }
    location.replace(${JSON.stringify(ROUTE_PREFIX)} + '/' + entry.fam + '/' + entry.port + entry.rest);
  } catch (e) {
    report('storage-error: ' + (e && e.message ? e.message : String(e)));
  }
})();`

const HEAD_OPEN = /<head(?:\s[^>]*)?>/i

/** `tapIndex` transform: guard right after the first `<head …>` (prepended when there is none). */
export function insertGuard(html: string): string {
  const markup = `<script>${GUARD_SCRIPT}</script>`
  const open = HEAD_OPEN.exec(html)
  if (open === null) return `${markup}${html}`
  const at = open.index + open[0].length
  return `${html.slice(0, at)}${markup}${html.slice(at)}`
}
