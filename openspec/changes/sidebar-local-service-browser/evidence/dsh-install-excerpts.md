# 安装包源码摘录（只读复制，供评审核验）

采集：2026-11-23，安装于 /Users/bytedance/.npm/_npx/72500ffcd8799faa/node_modules/@deepseek-ai/

## dsh-client-connection@0.2.2-rc.1 lib/index.js
```js
240: function isTrustedApiRequest(request, trustedHosts, bindHost, protocol = "http:") {
241: 	const host = header$1(request.headers, "host");
242: 	if (host === void 0) return false;
243: 	const hostUrl = parseAuthority(host, protocol);
244: 	if (hostUrl === void 0) return false;
245: 	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts, protocol) && !isBindAddressAuthority(hostUrl, bindHost)) return false;
246: 	if (header$1(request.headers, "sec-fetch-site") === "cross-site") return false;
247: 	const origin = header$1(request.headers, "origin");
248: 	if (origin === void 0) return true;
249: 	return isSameAuthorityOrigin(origin, host);
250: }
…
258: function isSameAuthorityOrigin(origin, host) {
259: 	let originUrl;
260: 	try {
261: 		originUrl = new URL(origin);
262: 	} catch {
263: 		return false;
264: 	}
265: 	const scheme = originUrl.protocol === "https:" ? "https:" : originUrl.protocol === "http:" ? "http:" : void 0;
266: 	if (scheme === void 0) return false;
267: 	const hostUrl = parseAuthority(host, scheme);
268: 	return hostUrl !== void 0 && originUrl.host === hostUrl.host;
…
277: const COOKIE_PREFIX = "dsh-auth-";
…
306: /** Protocol-scoped cookie audience; HTTP retains its existing authority-only spelling. */
307: function requestAudience(headers, secure) {
308: 	const host = header(headers, "host");
309: 	if (host === void 0) return void 0;
310: 	try {
311: 		const url = new URL(`${secure ? "https:" : "http:"}//${host}`);
312: 		return secure ? url.origin : url.host;
313: 	} catch {
314: 		return;
315: 	}
…
335: function cookieName(authority) {
336: 	return COOKIE_PREFIX + encodeBase64Url(createHash("sha256").update(authority).digest());
337: }
338: /** Read the exact generated cookie without implementing general Cookie decoding. */
339: function cookieValue(headerValue, name) {
340: 	for (const segment of headerValue.split(";")) {
341: 		const at = segment.indexOf("=");
342: 		if (at === -1 || segment.slice(0, at).trim() !== name) continue;
343: 		return segment.slice(at + 1).trim();
344: 	}
345: }
346: /** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url. */
347: function sessionCookie(name, value, expiresAt, maxAgeSeconds, secure) {
348: 	const attributes = `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`;
349: 	return secure ? `${attributes}; Secure` : attributes;
…
558: 	}
559: 	authenticate(request, secure) {
560: 		const authority = requestAudience(request.headers, secure);
561: 		const rawCookie = header(request.headers, "cookie");
562: 		if (authority === void 0 || rawCookie === void 0) return void 0;
563: 		const value = cookieValue(rawCookie, cookieName(authority));
564: 		if (value === void 0) return void 0;
565: 		const payload = decodeCookie(value, this.secret);
566: 		if (payload === void 0 || payload.authority !== authority) return void 0;
567: 		const now = Date.now();
568: 		if (payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > this.maxAgeMilliseconds) return void 0;
569: 		return payload;
570: 	}
…
736: 	/** Apply the Host/Origin fence and require an authenticated live Peer. */
737: 	requestRejection(request) {
738: 		const admission = this.admit(request);
739: 		return "rejection" in admission ? admission.rejection : void 0;
740: 	}
741: 	/** Browser requests share an owner Peer; API HTTP does not depend on an attached socket. */
742: 	admit(request) {
743: 		if (!this.isTrusted(request)) return { rejection: 403 };
744: 		if (this.disposed) return { rejection: 401 };
745: 		const secure = this.owner.get("webServer")?.protocol === "https:";
746: 		if (this.browserAuth.isAuthenticated(request, secure)) return { peer: this.browserPeer };
747: 		const id = this.browserAuth.authenticateApi(request, secure);
748: 		const record = id === void 0 ? void 0 : this.peers.get(id);
749: 		return record === void 0 ? { rejection: 401 } : { peer: record.peer };
750: 	}
…
777: 	isTrusted(request) {
778: 		const carrier = this.owner.get("webServer");
779: 		return isTrustedApiRequest(request, this.trustedHosts, carrier?.host, carrier?.protocol ?? "http:");
780: 	}
…
```

## dsh-host-webserver@0.2.2-rc.1 lib/index.js
```js
342: 	get port() {
343: 		return this.listenedPort;
344: 	}
…
375: 	register(route) {
376: 		const table = route.kind === "exact" ? this.exact : this.prefixes;
377: 		if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
378: 		table.set(route.path, route);
379: 		return () => {
380: 			table.delete(route.path);
381: 		};
382: 	}
383: 	/**
384: 	* Register an exact-path HTTP upgrade route. Duplicate paths throw because
385: 	* one socket can have only one protocol owner.
386: 	* @param route - pathname and handler owning negotiation plus socket use.
387: 	* @returns the disposer removing the route.
388: 	*/
389: 	registerUpgrade(route) {
390: 		if (this.upgrades.has(route.path)) throw new Error(`webserver: duplicate upgrade route "${route.path}"`);
391: 		this.upgrades.set(route.path, route);
392: 		return () => {
393: 			this.upgrades.delete(route.path);
394: 		};
…
461: 			requests; the field is only optional on the client-side IncomingMessage type */
462: 			const target = new URL(req.url ?? "/", "http://x");
463: 			const responder = this.responderFor(target.pathname);
464: 			if (responder === void 0) {
465: 				res.writeHead(404);
466: 				res.end();
467: 				return;
468: 			}
469: 			if (typeof responder === "function") await responder(req, res);
470: 			else if ("resource" in responder) await this.serveResource(req, res, target, responder.resource);
471: 			else await responder.handler(req, res);
472: 		};
473: 		const listener = (req, res) => {
…
520: 				let route;
521: 				try {
522: 					/* v8 ignore next -- node:http always sets url on server requests. */
523: 					route = this.upgrades.get(new URL(req.url ?? "/", "http://x").pathname);
524: 				} catch (error) {
525: 					this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)));
526: 					socket.destroy();
527: 					return;
528: 				}
529: 				if (route === void 0) {
530: 					socket.destroy();
531: 					return;
532: 				}
…
551: 					this.listenedPort = this.server.address().port;
…
576: 	responderFor(pathname) {
577: 		return this.match(pathname) ?? this.fallback;
578: 	}
579: 	/** Longest-prefix-wins over the prefix table after an exact-table miss. */
580: 	match(pathname) {
581: 		const exact = this.exact.get(pathname);
582: 		if (exact !== void 0) return exact;
583: 		let best;
584: 		for (const [prefix, route] of this.prefixes) {
585: 			if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
586: 			if (best === void 0 || prefix.length > best.path.length) best = route;
587: 		}
588: 		return best;
589: 	}
590: 	/**
…
```

## dsh-host-webserver lib/index.js（index 注入行，第 3 版补充）
```js
26: 	throw new Error(`webserver: unknown index injection row ${JSON.stringify(row)}`);
27: }
28: /** Render one row to markup with its placement. */
29: function renderRow(row) {
30: 	switch (row.kind) {
31: 		case "global": return {
32: 			placement: "head",
33: 			markup: `<script>globalThis[${JSON.stringify(row.name).replaceAll("<", "\\u003c")}] = ${row.value === void 0 ? "undefined" : JSON.stringify(row.value).replaceAll("<", "\\u003c")}<\/script>`
34: 		};
35: 		case "script": return {
36: 			placement: row.placement,
37: 			markup: `<script>${row.text}<\/script>`
38: 		};
39: 		case "script-src": return {
40: 			placement: row.placement,
…
79: function renderIndexInjections(html, rows) {
80: 	let head = "";
81: 	let body = "";
82: 	for (const row of rows) {
83: 		const rendered = renderRow(row);
84: 		if (rendered.placement === "head") head += rendered.markup;
85: 		else body += rendered.markup;
86: 	}
87: 	body += READY_MARKUP;
88: 	let out = html;
89: 	if (head !== "") {
90: 		const open = /<head(?:\s[^>]*)?>/i.exec(out);
91: 		out = open === null ? `${head}${out}` : splice(out, open.index + open[0].length, head);
92: 	}
93: 	if (body !== "") {
94: 		const open = /<body(?:\s[^>]*)?>/i.exec(out);
95: 		out = open === null ? `${out}${body}` : splice(out, open.index + open[0].length, body);
96: 	}
97: 	return out;
…
640: 	* `webserver/index-inject` emit, every subscriber pushes its current rows.
641: 	* Fresh per call, so subscribers read live state (module graph, theme
642: 	* preference, the Peer's access) at emit time.
643: 	* @param peer - the Peer the page speaks for.
644: 	* @returns rows in subscriber activation order.
645: 	*/
646: 	collectIndexInjections(peer) {
647: 		const table = [];
648: 		this.ctx.emit("webserver/index-inject", table, peer);
649: 		return table;
650: 	}
651: 	/**
652: 	* Render one index.html body for one Peer: the structured injection table
653: 	* first, then the raw `tapIndex` transforms over the result.
654: 	* @param html - the raw index.html body.
655: 	* @param peer - the Peer the page speaks for.
656: 	* @returns the transformed body.
657: 	*/
658: 	renderIndex(html, peer) {
659: 		return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections(peer)));
660: 	}
```

dsh-host-webserver lib/types/index.d.ts:33
```ts
        'webserver/index-inject'(table: IndexInjection[], peer: PeerScope): void;
```

## dsh-host-frontend-static@0.2.2-rc.1 lib/index.js（SPA fallback 只在 / 返回 index，其余 404）
```js
68: async function serveStatic(request, distRoot, distIndex, authorizeIndex, renderIndex) {
69: 	const target = resolve(normalize(join(distRoot, decodeURIComponent(new URL(request.url).pathname))));
70: 	if (target !== distRoot && !target.startsWith(distRoot + sep)) return new Response(null, { status: 403 });
71: 	let body;
72: 	let headers;
73: 	try {
74: 		if (target === distRoot || target === distIndex) {
75: 			const refusal = authorizeIndex();
76: 			if (refusal !== void 0) return refusal;
77: 			body = renderIndex(await readFile(distIndex, "utf8"));
78: 			headers = { "content-type": HTML_MIME };
79: 		} else {
80: 			body = await readFile(target);
81: 			const cache = {
82: 				"cache-control": "no-cache",
83: 				etag: `W/"${createHash("sha1").update(body).digest("base64url")}"`
84: 			};
85: 			if (request.headers.get("if-none-match") === cache.etag) return new Response(null, {
86: 				status: 304,
87: 				headers: cache
88: 			});
89: 			headers = {
90: 				"content-type": MIME[extname(target)] ?? "application/octet-stream",
91: 				...cache
92: 			};
93: 		}
94: 	} catch (error) {
95: 		if (!STATIC_MISS_CODES.has(error.code)) throw error;
96: 		return new Response(null, { status: 404 });
97: 	}
98: 	if (request.method === "HEAD") return new Response(null, {
99: 		status: 200,
100: 		headers
…
132: 	ctx.effect(() => ctx.webServer.registerFallback({ resource: (request, peer) => serveStatic(request, distRoot, distIndex, () => peer === void 0 ? authorizeIndex(request) : void 0, (html) => ctx.webServer.renderIndex(html, peer ?? ctx.connection.browserPeer).replace(/<head(?:\s[^>]*)?>/i, (open) => `${open}<base href="./">`)) }), "frontend-static: fallback seat");
```
