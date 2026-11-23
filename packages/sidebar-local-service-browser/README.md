# dsh-sidebar-local-service-browser

English · [简体中文](README.zh.md)

<!-- problem -->
When you use DSH on a remote machine through Cockpit, the dev server the agent starts there (say `127.0.0.1:5173`) resolves to your own computer in your browser, so you cannot see it, and every service needs its own SSH tunnel. This plugin adds a "本地服务" (Local services) tab to the right sidebar that opens `127.0.0.1:<port>` of the **DSH Host machine** through DSH's own web server, so it travels over the tunnel DSH already uses and needs no new port or tunnel.

**What you get**

- **Type an address, see the Host's port.** `127.0.0.1:5173/app`, `localhost:5173` and `[::1]:8080` are accepted; the address bar and the page's own scripts see the direct address, never a proxy prefix.
- **Ordinary dev apps keep working.** Root-path assets and hard-coded cross-port loopback URLs, SPA routing (`pushState`, `location.assign/replace/reload`), links and forms (including `form.submit()` and file upload), HMR WebSockets, cookie login and CSRF tokens read through `document.cookie`, and Back/Forward inside the tab.
- **No new surface to expose.** No new port, no tunnel, no change to Cockpit, its bridge or `better-sidebar`.

**Install.** Managed through `dsh.yaml` (entry `sidebar-local-service-browser`, `source: local`): set `enabled: true`, run `dsh build`, then restart DSH. It needs the third-party `better-sidebar` plugin (`dsh-better-sidebar`, peer `>=0.16.0`, optional): without it the tab and the Service Worker are never registered. The Host half additionally needs the official `connection` service and registers nothing when it is missing. Requires DSH `>=0.2.2-rc.1` and a **Chromium-family browser** (Navigation API and Service Workers). Design and acceptance live in the OpenSpec change `sidebar-local-service-browser`.

## Using it

Open the tab and type an address. Only `http:` addresses on `127.0.0.1`, `localhost` or `[::1]` **with an explicit port** (1–65535) are accepted; `http://` may be left out. The port is read from the text you typed, so `http://localhost:80/` really means port 80.

| Input | Loads | Shown in the address bar |
|---|---|---|
| `localhost:5173/app?x=1#top` | Host `127.0.0.1:5173` | `http://127.0.0.1:5173/app?x=1#top` |
| `127.0.0.1:8080` | Host `127.0.0.1:8080` | `http://127.0.0.1:8080/` |
| `[::1]:8080/` | Host `[::1]:8080` | `http://[::1]:8080/` |
| `https://…`, other hosts, `user@host`, no port, port out of range | nothing; the page already shown stays | an error message in the tab |

- **Only open services you trust.** The tab shows this reminder permanently; see "Trust model" below.
- **Links to other sites** are not followed inside the frame. A notice bar appears and the link opens in a new window only when you click it. A redirect to an external site during navigation shows a notice page instead.
- **Back/Forward** work inside the tab, including across different services (`:5173` → `:8000` → Back). Bookmarks and opening the unprefixed address elsewhere are not supported.

## Support matrix

| Works | Does not (see "Known exceptions" and "Non-goals") |
|---|---|
| HTTP on the Host's `127.0.0.1` / `::1`, any port except DSH's own | HTTPS upstreams, non-loopback hosts, port discovery |
| Redirects between loopback ports (rewritten into the proxy) | Redirects to external sites inside the frame (notice page) |
| WebSocket / HMR from the page (not from Workers) | WebSocket and `fetch` created inside Workers |
| `document.cookie`, `localStorage`, `sessionStorage` (per port view) | `cookieStore`, a Service Worker registered by the proxied page |
| Chromium-family browsers | Firefox, Safari (the tab refuses to load and says why) |

## Trust model

- **Every proxied request needs a DSH browser session** (the official `connection.requestRejection` fence) **and** `Sec-Fetch-Site: same-origin` or `none`. WebSocket upgrades are fenced by the same official check, which compares `Origin` with `Host` exactly. Unauthenticated or cross-site requests never reach an upstream.
- **Targets are limited** to the Host's own `127.0.0.1:<port>` or `[::1]:<port>`, chosen only by the URL family segment, and never DSH's own port.
- **The proxied page is same-origin with DSH.** Its scripts can call DSH's APIs and read DSH's DOM and IndexedDB. Adding `sandbox` to the iframe would break the Service Worker and authentication, so this cannot be removed. The only mitigations are: loopback targets only, loading only on explicit user input, the permanent reminder, and the note in `dsh.yaml`.
- **Proxy cookies leave the browser's jar scope.** Browsers do not separate cookies by port, so cookies of a proxied service (stored as `dshls.<authority hash>.<family>.<port>.<name>`, `Path=/`, `HttpOnly` preserved) are also sent to other services on the same loopback host of **your computer**, such as other DSH tunnels or Cockpit. The Host forwards upstream only cookies for the same DSH authority and the same port, and never `dsh-auth-*` or any other cookie. This residual risk comes from the browser cookie model and cannot be removed.
- **A proxied page cannot register its own Service Worker.** Script fetches carrying `Service-Worker: script` get 403, `Service-Worker-Allowed` is removed, and the injected script rejects `register()`. When the tab mounts it unregisters any registration whose script URL starts with `/dsh-local-service/p`.

## Known exceptions

Fail-closed behaviour is best effort, not a guarantee of zero leakage. These cases can still reach the loopback addresses of the computer running the browser:

- `fetch` and WebSocket created inside **Workers**, and root-path addresses inside a Worker's own script;
- an **iframe nested inside** the proxied page;
- when the page is not controlled by the plugin's Service Worker or the identity table is unavailable, scripts the parser has already read before `window.stop()` can run once.

Other behaviour to know about:

- **Cross-document Back/Forward first sends one GET to DSH for the unprefixed path** (the browser asks for the old URL before the plugin restores the entry). Only `/` and `/index.html` return HTML there, and a guard in DSH's index stops DSH from booting inside the frame; other paths return 404 or a static file. The GET has no side effects unless another DSH plugin serves a side-effecting GET route at exactly the same path as a page you visited.
- Other plugins' index taps inserting into the same `<head>` position can push the guard away from the first executable position; the repository currently has none.
- **Non-HTML documents cannot be viewed in the tab.** Opening an API address directly makes the frame navigate to a JSON, plain-text or PDF response. That response has no injected script, so the tab fails closed: the frame is blanked and shows "the page blocked the injected script". Pages that request such resources with `fetch` are not affected.
- `IndexedDB`, Cache Storage and `BroadcastChannel` are not separated by port; they are DSH's own origin.
- `location.host` and `location.origin` report DSH's address, not the service's. Cookies share `Path=/` per port.
- Every proxy cookie rides along on every same-origin request, so many open ports mean larger request headers; if they exceed a limit, DSH's HTTP parser or the upstream may reject the request.

## Non-goals

HTTPS or non-loopback upstreams, port discovery, bookmarks, non-Chromium browsers, a proxied page's own Service Worker, `cookieStore`, per-port isolation of IndexedDB/Cache Storage/BroadcastChannel.

## Removing a leftover Service Worker by hand

Disabling the plugin does not unregister the browser's Service Worker by itself. If the old worker lingers, its requests under `/dsh-local-service/…` get a plain 404 from DSH. To remove it, open DSH in the affected browser and either use DevTools → Application → Service Workers → Unregister (scope `…/dsh-local-service/`), or run in the DevTools console:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs
  .filter(r => new URL(r.scope).pathname === '/dsh-local-service/')
  .forEach(r => r.unregister()))
```

## Development

Run from the package directory:

```sh
npm run build          # lib/index.js (Host), lib/client.js (tab), lib/*.d.ts
npm run typecheck
npm test               # Node suite: Host proxy, harness, jsdom tab tests
npm run test:browser   # headless Chrome suite (needs Chrome: DSHLS_CHROME)
```

The Service Worker script (`src/sw`) and the injected page script (`src/inject`) are bundled to minified IIFEs and inlined into the Host bundle as the virtual modules `virtual:dshls/sw` and `virtual:dshls/inject` (plugin in `tsdown.config.ts`, shared with `vitest.config.ts`). A missing entry fails the build; there is no placeholder in a built artifact. (`ALLOW_PLACEHOLDER_ASSETS_BY_DEFAULT` in `tsdown.config.ts` is `false`; `DSHLS_REQUIRE_ASSETS=1` forces strict mode regardless of it, and only vitest tolerates a missing entry so Host tests stay runnable.)

`test/support/host-harness.ts` starts a real DSH Host WebServer, the real `@deepseek-ai/dsh-client-connection` (signed browser-session cookies, Host/Origin fence) and counting upstream servers; see the file header for usage.

## Removal

<!-- section: removal -->
Set `enabled: false` on the `sidebar-local-service-browser` entry in `dsh.yaml`, run `dsh build`, and restart the DSH Host. The Host routes (`/dsh-local-service`, `/dsh-local-service/ws`) and the index guard disappear and any in-flight proxied connections are closed. The tab is removed, and the plugin unregisters its Service Worker when it unloads. If a browser still holds the worker, requests under `/dsh-local-service/…` get 404 from DSH; remove it with the steps above. Nothing else is persisted: the only data this plugin leaves behind is per-tab entries in the browser's `sessionStorage` (`__dshls.entries.*`, dropped when the tab closes) and proxy cookies named `dshls.…` that expire with the browser session or their own lifetime.
