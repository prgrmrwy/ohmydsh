/**
 * @module dsh-session-title-copy
 *
 * Host-side entry of the plugin: a minimal no-op cordis plugin.
 *
 * All real functionality lives in the browser bundle (`src/client/index.ts` →
 * `lib/client.js`), which runs inside the DSH web client. This host half
 * exists for one structural reason: `cordis.patch.yml` inserts
 * `dsh-session-title-copy` as a profile bundle row, so the DSH loader imports
 * this package's main entry at boot. Without it the loader fails with
 * `ERR_MODULE_NOT_FOUND` on `lib/index.js` and the whole plugin tree — i.e.
 * the entire DSH process — refuses to start (the dsh-cockpit-bridge v0.1.0
 * incident). Being a loader entry is also what makes the client half
 * reachable: the client-modules scanner discovers the browser bundle declared
 * in package.json (`dsh.client` + `exports["./client"]`) and serves it at
 * `/plugins/dsh-session-title-copy/client.js` in the Web boot manifest.
 *
 * Keep this file free of side effects: no network, filesystem or session
 * state. The browser half alone reads the sessions list store and the
 * clipboard.
 */

/** Stable cordis plugin name. */
export const name = 'dsh-session-title-copy'

/** Services required before this plugin mounts (none host-side). */
export const inject: string[] = []

/** No-op host-side apply: the plugin is browser-only by design. */
export function apply(): void {}
