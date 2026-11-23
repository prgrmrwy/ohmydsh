// Minimal browser feasibility probe for sidebar-local-service-browser (round-4 revision).
// Topology (all loopback, random ports): cockpit page --iframe--> fake DSH page (tab)
// --iframe[data-dshls]--> /dsh-local-service/p/<U>/... (minimal proxy) --> upstreams U1 / U2.
// Pages self-report to /__r; the script prints the collected log as JSON on stdout.
// This is probe code, not the plugin: it mirrors the design's mechanisms with minimal logic.
// Usage: node browser-feasibility.mjs [path-to-chrome]
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.argv[2] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const log = []
const note = (src, data) => log.push({ t: Date.now(), src, ...data })
let done
const finished = new Promise(r => { done = r })
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))
const fill = (text, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`__${k}__`, String(v)), text)

// ---------------------------------------------------------------- upstreams
const PAGE_REPORT = 'const r = (d) => fetch("/__r", { method: "POST", body: JSON.stringify({ src: "page", ...d }) });'
const START_BODY = `<script>
${PAGE_REPORT}
(async () => {
  const out = { pathname: location.pathname + location.search, controlled: !!navigator.serviceWorker.controller, preHead: window.__preHead }
  try { out.asset = await (await fetch('/assets/a.js')).text() } catch (e) { out.asset = 'ERR ' + e }
  try { out.cross = await (await fetch('http://127.0.0.1:__U2__/api/x')).text() } catch (e) { out.cross = 'ERR ' + e }
  out.cookie = document.cookie
  document.cookie = 'theme=dark'
  out.cookieAfterSet = document.cookie
  try { localStorage.setItem('a', '1'); localStorage.clear(); out.lsCleared = true } catch (e) { out.lsErr = String(e) }
  try { await navigator.serviceWorker.register('/sw.js'); out.swRegister = 'resolved' } catch (e) { out.swRegister = e.name }
  try { const ws = new WebSocket('ws://localhost:__U1__/hmr'); ws.onerror = () => {}; out.wsUrl = ws.url } catch (e) { out.wsErr = String(e) }
  await r({ step: 'start', ...out })
})()
</script>`

function upstream(name) {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      note(name, { method: req.method, url: req.url, viaProxy: req.headers['x-via-proxy'] === '1', cookie: req.headers.cookie, body: body || undefined })
      const html = (s, headers = {}) => { res.writeHead(200, { 'content-type': 'text/html', ...headers }); res.end(s) }
      if (req.url.startsWith('/assets/')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`${name}-asset`) }
      if (req.url.startsWith('/api')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`${name}-api`) }
      if (req.url.startsWith('/sw.js')) { res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' }); return res.end('') }
      if (req.url.startsWith('/start')) {
        res.setHeader('set-cookie', ['csrftoken=t1; Path=/start', 'sid=s1; Path=/; HttpOnly'])
        // A script BEFORE <html>/<head>: the inject must still run first.
        return html(`<!doctype html><!-- c --><script>window.__preHead = { injectRanFirst: !!window.__dshlsMarker, path: location.pathname }</script><html><head><title>${name}</title></head><body>${name} start ${fill(START_BODY, { U1, U2 })}</body></html>`)
      }
      if (req.url.startsWith('/csp')) {
        return html(`<!doctype html><html><head></head><body>${name} csp
<script nonce="old">fetch("/__r",{method:"POST",body:JSON.stringify({src:"page",step:"csp-old-nonce-ran",marker:!!window.__dshlsMarker})})</script>
<script>fetch("/__r",{method:"POST",body:JSON.stringify({src:"page",step:"csp-plain-inline-ran"})})</script></body></html>`,
        { 'content-security-policy': "script-src 'unsafe-inline' 'nonce-old'; connect-src 'self'" })
      }
      if (req.url.startsWith('/form')) return html(`<!doctype html><html><head></head><body>${name} form-result ${body}</body></html>`)
      return html(`<!doctype html><html><head></head><body>${name} page ${req.url}</body></html>`)
    })
  })
}
const u1 = upstream('U1'); const U1 = await listen(u1)
const u2 = upstream('U2'); const U2 = await listen(u2)

// ---------------------------------------------------------------- injected script (inline, per response)
// Config placeholders are filled by the proxy per response: __FAM__, __PORT__, __CP__ (cookie prefix with DSH-authority hash).
const INJECT = `(() => {
  const FAM = '__FAM__', PORT = '__PORT__', CP = '__CP__'
  const PFX = '/dsh-local-service/' + FAM + '/' + PORT
  const r = (d) => fetch('/__r', { method: 'POST', body: JSON.stringify({ src: 'inject', ...d }) })
  if (!navigator.serviceWorker.controller) { window.stop(); r({ step: 'uncontrolled' }); return }
  Object.defineProperty(window, '__dshlsMarker', { value: true })
  const SS = window.sessionStorage, MAPKEY = '__dshls.entries'
  const rest = location.pathname.slice(PFX.length) || '/'
  history.replaceState(history.state, '', rest + location.search + location.hash)
  const rec = () => { const m = JSON.parse(SS.getItem(MAPKEY) || '{}'); m[navigation.currentEntry.key] = { fam: FAM, port: PORT, rest: location.pathname + location.search + location.hash }; SS.setItem(MAPKEY, JSON.stringify(m)) }
  rec()
  navigation.addEventListener('currententrychange', rec)
  const loop = (u) => /^(127\\.0\\.0\\.1|localhost|\\[::1\\])$/.test(u.hostname)
  const toProxy = (u) => {
    if (u.origin === location.origin) return u.pathname.startsWith('/dsh-local-service/') ? null : PFX + u.pathname + u.search + u.hash
    if (u.protocol === 'http:' && loop(u) && u.port) return '/dsh-local-service/' + (u.hostname === '[::1]' ? 'p6' : 'p') + '/' + u.port + u.pathname + u.search + u.hash
    return null
  }
  document.addEventListener('submit', (e) => { const f = e.target; const t = toProxy(new URL(f.action, location.href)); if (t) f.action = t }, true)
  navigation.addEventListener('navigate', (e) => {
    if (e.destination.sameDocument) return
    const u = new URL(e.destination.url); const t = toProxy(u)
    const info = { type: e.navigationType, cancelable: e.cancelable, url: u.pathname + u.search, form: !!e.formData, rewriteTo: t }
    if (t && e.cancelable && e.navigationType !== 'traverse') {
      e.preventDefault(); info.cancelled = true
      if (e.formData && e.sourceElement && e.sourceElement.tagName === 'FORM') { info.viaSourceElement = true; e.sourceElement.action = t; HTMLFormElement.prototype.submit.call(e.sourceElement) }
      else navigation.navigate(t, { history: e.navigationType === 'push' ? 'push' : 'replace' })
    }
    if (t) r({ step: 'navigate', ...info })
  })
  const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  Object.defineProperty(Document.prototype, 'cookie', { configurable: true, enumerable: true,
    get() { return d.get.call(this).split('; ').filter(c => c.startsWith(CP)).map(c => c.slice(CP.length)).join('; ') },
    set(v) { d.set.call(this, CP + String(v).replace(/;\\s*(path|domain)=[^;]*/gi, '') + '; Path=/') } })
  const real = window.localStorage
  const wrap = { getItem: k => real.getItem(CP + k), setItem: (k, v) => real.setItem(CP + k, v), removeItem: k => real.removeItem(CP + k),
    clear: () => { for (let i = real.length - 1; i >= 0; i--) { const k = real.key(i); if (k.startsWith(CP)) real.removeItem(k) } } }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: wrap })
  navigator.serviceWorker.register = () => Promise.reject(new DOMException('blocked by dshls', 'SecurityError'))
  const OrigWS = window.WebSocket
  window.WebSocket = function (url, p) { const h = new URL('http' + new URL(url, location.href).href.slice(2)); let w = url
    if (loop(h) || h.host === location.host) w = 'ws://' + location.host + '/dsh-local-service/ws?fam=' + FAM + '&port=' + (h.host === location.host ? PORT : h.port) + '&path=' + encodeURIComponent(h.pathname + h.search)
    return new OrigWS(w, p) }
  window.WebSocket.prototype = OrigWS.prototype
  r({ step: 'inject', port: PORT, afterPath: location.pathname })
})()`

// ---------------------------------------------------------------- plugin service worker
const SW = `
const map = new Map()
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
const r = (d) => fetch('/__r', { method: 'POST', body: JSON.stringify({ src: 'sw', ...d }) })
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (u.pathname === '/__r') return
  if (e.request.mode === 'navigate') {
    const m = u.pathname.match(/^\\/dsh-local-service\\/(p6?)\\/(\\d+)/)
    if (m && e.resultingClientId) map.set(e.resultingClientId, { fam: m[1], port: m[2] })
    return
  }
  let target
  const loop = /^(127\\.0\\.0\\.1|localhost|\\[::1\\])$/.test(u.hostname)
  if (u.origin === self.location.origin && !u.pathname.startsWith('/dsh-local-service/')) {
    const id = map.get(e.clientId)
    if (!id) { r({ step: 'unknown-client', url: u.pathname }); e.respondWith(new Response('unknown client', { status: 502 })); return }
    target = '/dsh-local-service/' + id.fam + '/' + id.port + u.pathname + u.search
  } else if (u.protocol === 'http:' && loop && u.port && u.origin !== self.location.origin) {
    target = '/dsh-local-service/p/' + u.port + u.pathname + u.search
  }
  if (!target) return
  r({ step: 'rewrite', from: u.href, to: target })
  e.respondWith(fetch(new Request(target, { method: e.request.method, headers: e.request.headers, body: ['GET','HEAD'].includes(e.request.method) ? undefined : e.request.body, duplex: 'half', credentials: 'same-origin', redirect: 'manual' })))
})`

// ---------------------------------------------------------------- DSH index guard (inserted FIRST in <head>, as tapIndex would)
const GUARD = `<script>(() => { const fe = window.frameElement; if (!fe || !fe.hasAttribute('data-dshls')) return;
  const m = JSON.parse(sessionStorage.getItem('__dshls.entries') || '{}')[navigation.currentEntry.key];
  fetch('/__r', { method: 'POST', body: JSON.stringify({ src: 'guard', identity: m || null }) });
  window.stop(); if (m) location.replace('/dsh-local-service/' + m.fam + '/' + m.port + m.rest) })()</script>`
// Sentinel = stands in for DSH's own boot scripts; it must NOT run inside the tab iframe.
const SENTINEL = `<script>if (window.frameElement && window.frameElement.hasAttribute('data-dshls')) fetch('/__r', { method: 'POST', body: JSON.stringify({ src: 'dsh-index', step: 'booted-in-iframe' }) })</script>`

// ---------------------------------------------------------------- tab logic (runs only in the top DSH page, not when nested)
const TAB = `<script>
if (!(window.frameElement && window.frameElement.hasAttribute('data-dshls'))) (async () => {
const r = (d) => fetch('/__r', { method: 'POST', body: JSON.stringify({ src: 'tab', ...d }) })
const f = document.getElementById('f'); const wait = (ms) => new Promise(x => setTimeout(x, ms))
const where = () => { try { return { href: f.contentWindow.location.pathname + f.contentWindow.location.search, marker: !!f.contentWindow.__dshlsMarker, body: f.contentDocument.body && f.contentDocument.body.innerText.slice(0, 60) } } catch (e) { return { err: String(e) } } }
const ready = async () => { for (let i = 0; i < 50 && !(f.contentWindow && f.contentWindow.__dshlsMarker && f.contentDocument.readyState === 'complete'); i++) await wait(100); await wait(300) }
const ev = (code) => f.contentWindow.eval(code)
const fixup = async (label) => {
  await wait(1500); const w = where(); let id = null
  try { id = JSON.parse(sessionStorage.getItem('__dshls.entries') || '{}')[f.contentWindow.navigation.currentEntry.key] || null } catch (e) { id = 'ERR ' + e }
  r({ step: label + '-raw', ...w, identity: id })
  if (!w.marker && id && id.port) { f.contentWindow.location.replace('/dsh-local-service/' + id.fam + '/' + id.port + id.rest); await wait(1500); await ready() }
  r({ step: label + '-fixed', ...where() })
}
localStorage.setItem('dsh.settings', 'keep')
try { await navigator.serviceWorker.register('/dsh-local-service/p/__U1__/sw.js', { scope: '/' }); r({ step: 'upstream-sw-root', ok: true }) } catch (e) { r({ step: 'upstream-sw-root', ok: false, e: e.message.slice(-60) }) }
const reg = await navigator.serviceWorker.register('/dsh-local-service/sw.js', { scope: '/dsh-local-service/' })
for (let i = 0; i < 50 && !reg.active; i++) await wait(100)
r({ step: 'sw-active', active: !!reg.active, dshControlled: !!navigator.serviceWorker.controller })
f.src = '/dsh-local-service/p/__U1__/start?x=1'; await ready(); await wait(800); r({ step: 'at-start', ...where() })
ev("location.assign('/login')"); await wait(1500); await ready(); r({ step: 'after-assign', ...where() })
ev("location.replace('http://localhost:__U1__/b')"); await wait(1500); await ready(); r({ step: 'after-replace', ...where(), entries: f.contentWindow.navigation.entries().length })
ev("location.reload()"); await wait(1500); await ready(); r({ step: 'after-reload', ...where(), entries: f.contentWindow.navigation.entries().length })
ev("const fm=document.createElement('form');fm.method='POST';fm.action='/form';const i=document.createElement('input');i.name='a';i.value='1';fm.appendChild(i);document.body.appendChild(fm);fm.requestSubmit()"); await wait(1500); await ready(); r({ step: 'after-requestSubmit', ...where() })
ev("const fm=document.createElement('form');fm.method='POST';fm.action='/form';const i=document.createElement('input');i.name='b';i.value='2';fm.appendChild(i);document.body.appendChild(fm);fm.submit()"); await wait(1500); await ready(); r({ step: 'after-submit', ...where() })
// R3-C1: SPA route change (same-document pushState + replaceState), then cross-port full navigation, then back.
ev("location.assign('/spa')"); await wait(1500); await ready()
ev("history.pushState(null, '', '/spa/route2'); history.replaceState({ app: 1 }, '', '/spa/route3')"); await wait(300); r({ step: 'spa-pushed', ...where() })
ev("location.href = 'http://127.0.0.1:__U2__/page2'"); await wait(1500); await ready(); r({ step: 'at-u2-page2', ...where() })
ev("history.back()"); await fixup('back-to-spa-route')
// Back onto DSH index '/': guard must stop DSH boot (sentinel must not report).
ev("location.assign('/')"); await wait(1500); await ready(); r({ step: 'at-u1-root', ...where() })
ev("location.assign('/page3')"); await wait(1500); await ready(); r({ step: 'at-u1-page3', ...where() })
ev("history.back()"); await wait(2500); await ready(); r({ step: 'after-back-to-root', ...where() })
ev("history.forward()"); await fixup('forward-to-page3')
// WebSocket to a port never loaded over HTTP (R2-M3).
try { ev("new WebSocket('ws://localhost:__U2__/hmr2')"); r({ step: 'ws-created' }) } catch (e) { r({ step: 'ws-created', e: String(e) }) }
await wait(800)
// R3-M1: CSP with 'unsafe-inline' + existing nonce.
ev("location.assign('/csp')"); await wait(1500); await ready(); r({ step: 'at-csp', ...where() })
// Positive control for the sentinel oracle: a data-dshls iframe loading DSH index WITHOUT the guard must report boot.
const c = document.createElement('iframe'); c.setAttribute('data-dshls', ''); c.src = '/?noguard'; document.body.appendChild(c)
await wait(1500)
r({ step: 'dsh-ls-after', value: localStorage.getItem('dsh.settings') })
r({ step: 'finish' })
})()
</script>`

// ---------------------------------------------------------------- minimal proxy helpers (mirroring design D4/D6)
const authorityHash = (host) => createHash('sha256').update(host).digest('base64url').slice(0, 8)
function injectAt(html) { // skip BOM, whitespace, doctype and comments; insert before the first other tag
  let i = 0
  for (;;) {
    const s = html.slice(i)
    const m = /^(\uFEFF|\s+|<!doctype[^>]*>|<!--[\s\S]*?-->)/i.exec(s)
    if (!m) return i
    i += m[0].length
  }
}
function rewriteCsp(value, nonce) { // per policy: effective script directive gets our nonce unless only 'unsafe-inline' allows inline
  return value.split(',').map(policy => {
    const dirs = policy.split(';').map(d => d.trim()).filter(Boolean)
    const pick = ['script-src-elem', 'script-src', 'default-src'].find(n => dirs.some(d => d.toLowerCase().startsWith(n + ' ') || d.toLowerCase() === n))
    if (!pick) return policy
    return dirs.map(d => {
      if (!(d.toLowerCase().startsWith(pick + ' ') || d.toLowerCase() === pick)) return d
      const hasNonceOrHash = /'(nonce-|sha256-|sha384-|sha512-)|'strict-dynamic'/i.test(d)
      if (/'unsafe-inline'/i.test(d) && !hasNonceOrHash) return d
      return d + ` 'nonce-${nonce}'`
    }).join('; ')
  }).join(', ')
}

const dsh = http.createServer((req, res) => {
  const h = req.headers
  if (req.url === '/__r') { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { const d = JSON.parse(b); note('report', d); if (d.step === 'finish') done(); res.end('ok') }); return }
  note('dsh', { method: req.method, url: req.url, sfs: h['sec-fetch-site'], sfd: h['sec-fetch-dest'], origin: h.origin })
  if (req.url === '/' || req.url === '/index.html' || req.url === '/?noguard') {
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'dsh-auth-x=sig; Path=/; HttpOnly; SameSite=Strict' })
    return res.end(`<!doctype html><html><head>${req.url === '/?noguard' ? '' : GUARD}${SENTINEL}</head><body>DSH<iframe id=f data-dshls style="width:800px;height:400px"></iframe>${fill(TAB, { U1, U2 })}</body></html>`)
  }
  if (req.url === '/dsh-local-service/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return res.end(SW) }
  const m = req.url.match(/^\/dsh-local-service\/(p6?)\/(\d+)(\/.*)?$/)
  if (m) {
    if (h['service-worker'] === 'script') { res.writeHead(403); return res.end() }
    const [, fam, port] = m
    const CP = `dshls.${authorityHash(h.host)}.${fam}.${port}.`
    const cookie = (h.cookie || '').split('; ').filter(c => c.startsWith(CP)).map(c => c.slice(CP.length)).join('; ')
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: m[3] || '/', headers: { 'x-via-proxy': '1', 'content-type': h['content-type'] || '', ...(cookie ? { cookie } : {}), 'accept-encoding': 'identity' } }, (ur) => {
      const headers = { ...ur.headers }
      delete headers['content-length']; delete headers['service-worker-allowed']
      if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(c => CP + c.replace(/;\s*(path|domain)=[^;]*/gi, '') + '; Path=/')
      const isHtml = (ur.headers['content-type'] || '').startsWith('text/html')
      const nonce = randomBytes(12).toString('base64url')
      if (isHtml && headers['content-security-policy']) headers['content-security-policy'] = rewriteCsp(headers['content-security-policy'], nonce)
      res.writeHead(ur.statusCode, headers)
      if (!isHtml) return ur.pipe(res)
      let buf = ''; ur.on('data', c => { buf += c }); ur.on('end', () => {
        const at = injectAt(buf)
        const tag = `<script nonce="${nonce}">${fill(INJECT, { FAM: fam, PORT: port, CP })}</script>`
        res.end(buf.slice(0, at) + tag + buf.slice(at))
      })
    })
    up.on('error', () => { res.writeHead(502); res.end() })
    return req.pipe(up)
  }
  res.writeHead(404); res.end()   // real DSH fallback: non-index, non-dist paths are 404
})
const D = await listen(dsh)
dsh.on('upgrade', (req, socket) => { note('dsh-upgrade', { url: req.url, origin: req.headers.origin, sfs: req.headers['sec-fetch-site'], cookie: req.headers.cookie }); socket.destroy() })

const cockpit = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><html><body>COCKPIT<iframe src="http://127.0.0.1:${D}/" style="width:900px;height:500px"></iframe></body></html>`) })
const C = await listen(cockpit)

const profile = mkdtempSync(join(tmpdir(), 'dshls-probe-'))
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', `http://127.0.0.1:${C}/`], { stdio: 'ignore' })
const timeout = setTimeout(() => { note('probe', { timeout: true }); done() }, 90000)
await finished
clearTimeout(timeout)
chrome.kill('SIGKILL')
for (const s of [u1, u2, dsh, cockpit]) s.close()
rmSync(profile, { recursive: true, force: true })
console.log(JSON.stringify({ chrome: CHROME, ports: { U1, U2, D, C }, authorityHash: authorityHash(`127.0.0.1:${D}`), log }, null, 1))
process.exit(0)
