window.__ModuleLoader__.load({
	id: "dsh-sidebar-session-provider-icon",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/provider-map.ts
		/**
		* Build the effective provider map. The model selector's observed `current`
		* selection wins immediately; the durable last-request projection is only a
		* cold-session fallback for rows whose selector store has not been loaded in
		* this browser process.
		* @param list - sessions list snapshot (host rows + current).
		* @param selected - selections observed from `ctx.modelDirectories` stores.
		* @returns sessionId → effective provider/model for every known selection.
		*/
		function providerBySession(list, selected = /* @__PURE__ */ new Map()) {
			const out = /* @__PURE__ */ new Map();
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0) continue;
				const current = selected.get(id);
				if (current !== void 0 && current.provider !== "") {
					out.set(id, current);
					continue;
				}
				const fallback = summary.projectionValues?.provider;
				if (fallback !== void 0 && fallback !== null && typeof fallback.provider === "string" && fallback.provider !== "") out.set(id, fallback);
			}
			return out;
		}
		/**
		* Index all session rows for reverse lookup by display title. Provider-bearing
		* filtering happens after row identity resolution: a blank session can have a
		* model-selector selection even though no request projection exists yet.
		* Keeps ids in list order so duplicate-title resolution is deterministic; the
		* caller advances through candidates with a per-pass used set.
		* @param list - the sessions list snapshot.
		* @returns display title → session ids in list order.
		*/
		function providerTitleIndex(list) {
			const out = /* @__PURE__ */ new Map();
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0) continue;
				const text = summary.displayTitle;
				if (text === "") continue;
				const bucket = out.get(text);
				if (bucket === void 0) out.set(text, [id]);
				else bucket.push(id);
			}
			return out;
		}
		//#endregion
		//#region src/client/assets/anthropic.svg
		var anthropic_default = "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Anthropic</title><path d=\"M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z\"></path></svg>";
		//#endregion
		//#region src/client/assets/deepseek.svg
		var deepseek_default = "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>DeepSeek</title><path d=\"M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z\" fill=\"#4D6BFE\"></path></svg>";
		//#endregion
		//#region src/client/assets/grok.svg
		var grok_default = "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Grok</title><path d=\"M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815\"></path></svg>";
		//#endregion
		//#region src/client/assets/openai.svg
		var openai_default = "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>OpenAI</title><path d=\"M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z\"></path></svg>";
		//#endregion
		//#region src/client/assets/opencode.svg
		var opencode_default = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path d=\"M8.40005 17.4H19.2001V21H4.80005V13.8H8.40005V17.4ZM15.6001 10.2V13.8H8.40005V10.2H15.6001ZM19.2001 10.2H15.6001V6.6H4.80005V3H19.2001V10.2Z\" fill=\"currentColor\"/>\n</svg>\n";
		const UNKNOWN_FILL = "#8a9199";
		/** Normalize opaque route/model ids without guessing display names. */
		function normalizeIdentity(value) {
			return value.trim().toLowerCase().replace(/^@[^/]+\//, "").replace(/^dsh[-_]?/i, "");
		}
		/**
		* Resolve a brand from the exact model selection. A recognized provider route
		* wins: `opencode-go/deepseek-v4-flash` is the OpenCode provider, not the
		* DeepSeek official provider. Model identity is only a fallback for generic or
		* otherwise unknown compatible routes.
		*/
		function brandKeyOf(provider, model) {
			const route = normalizeIdentity(provider);
			const picked = normalizeIdentity(model);
			if (route.includes("opencode")) return "opencode";
			if (route.includes("deepseek")) return "deepseek";
			if (route.includes("anthropic") || route.includes("claude")) return "anthropic";
			if (route.includes("grok") || route === "xai") return "grok";
			if (route.includes("openai") || route.includes("codex")) return "openai";
			if (picked.includes("opencode")) return "opencode";
			if (picked.includes("deepseek")) return "deepseek";
			if (picked.includes("anthropic") || picked.includes("claude")) return "anthropic";
			if (picked.includes("grok")) return "grok";
			if (picked.includes("gpt") || picked.includes("codex")) return "openai";
		}
		const LOGOS = {
			deepseek: deepseek_default,
			openai: openai_default,
			opencode: opencode_default,
			anthropic: anthropic_default,
			grok: grok_default
		};
		/** Normalize bundler text/data-url forms, then size without editing the downloaded path. */
		function sizedSvg(imported) {
			return (imported.startsWith("data:image/svg+xml,") ? decodeURIComponent(imported.slice(19)) : imported).replace(/<svg\b[^>]*>/, (tag) => {
				return tag.replace(/\s(?:width|height)=(?:"[^"]*"|'[^']*')/g, "").replace(/\sstyle=(?:"[^"]*"|'[^']*')/g, "").replace("<svg", `<svg width="14" height="14" aria-hidden="true" style="display:block;color:currentColor"`);
			});
		}
		/** Escape the one-character unknown-brand label before assigning innerHTML. */
		function escapeHtml(text) {
			return text.replace(/[&<>"']/g, (char) => ({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				"\"": "&quot;",
				"'": "&#39;"
			})[char] ?? char);
		}
		/** Render downloaded brand SVG, or a neutral letter for a genuinely unknown route. */
		function badgeInnerHTML(provider, model) {
			const key = brandKeyOf(provider, model);
			if (key !== void 0) return sizedSvg(LOGOS[key]);
			const letter = normalizeIdentity(model || provider).slice(0, 1).toUpperCase() || "?";
			return `<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:4px;background:${UNKNOWN_FILL};color:#fff;font-size:9px;line-height:1;font-weight:600">${escapeHtml(letter)}</span>`;
		}
		/** Human tooltip for the exact selector state. */
		function badgeTitle(provider, model) {
			return model !== "" ? `${provider} · ${model}` : provider;
		}
		//#endregion
		//#region src/client/row-locator.ts
		/** Whether a DOM class token is the official session-row local class (suffix match). */
		const SESSION_ROW_SUFFIX = "sessionRow";
		/** Whether a DOM class token is the official title local class (suffix match). */
		const TITLE_SUFFIX = "title";
		/** Badge marker attribute set on inserted logo spans (self-owned, collision-free). */
		const BADGE_MARKER = "data-dsh-provider-logo";
		/** Stable class-suffix matcher for a given element. */
		function hasClassSuffix(node, suffix) {
			const cls = node.getAttribute("class");
			if (cls === null) return false;
			return cls.split(/\s+/).some((token) => token !== "" && token.endsWith(suffix));
		}
		/**
		* Identify whether a DOM node is an official session row (role treeitem with
		* the session-row local class). Workspace/project rows and search-result rows
		* do not match and are skipped by the renderer.
		* @param node - candidate node from the observed region.
		* @returns true for a session row.
		*/
		function isSessionRow(node) {
			return node.getAttribute("role") === "treeitem" && hasClassSuffix(node, SESSION_ROW_SUFFIX);
		}
		/**
		* Extract a row's title element (the badge slot sits immediately before it).
		* Returns null when the row structure is unrecognizable — callers treat that
		* as an unlocatable row and skip insertion.
		* @param row - a node already identified as a session row.
		* @returns the title node, or null.
		*/
		function titleNodeOf(row) {
			return row.querySelector(`span[class$="${TITLE_SUFFIX}"]`);
		}
		/**
		* Resolve a session row's id by its title text via a reverse index built by
		* the provider map (latest-launch semantics: blank rows have no provider and
		* are not indexed). Duplicate titles advance through the id list with a
		* per-pass `used` set; every resolution returns the first not-yet-used id so
		* a repeated title maps to distinct rows for the duration of one render pass.
		* @param titleNode - the row's title element.
		* @param index - display title → candidate session ids (provider-bearing only).
		* @param used - per-pass set of already-assigned session ids (mutated).
		* @returns the resolved session id, or undefined when unlocatable.
		*/
		function sessionIdOfRow(titleNode, index, used) {
			if (titleNode === null) return void 0;
			const text = titleNode.textContent ?? "";
			const candidates = index.get(text);
			if (candidates === void 0) return void 0;
			for (const id of candidates) if (!used.has(id)) {
				used.add(id);
				return id;
			}
		}
		//#endregion
		//#region src/client/selection-binding.ts
		/**
		* Bind one current session to its selector store. The caller records the
		* session id only after this function succeeds, so a transient resolver error
		* remains retryable on the next list/DOM signal.
		*/
		function bindSelectionDirectory(sessionId, resolve, selected, reconcile) {
			const directory = resolve(sessionId);
			const publish = () => {
				const current = directory.store.getSnapshot().current;
				if (current === null) selected.delete(sessionId);
				else selected.set(sessionId, {
					provider: current.provider,
					model: current.model
				});
				reconcile();
			};
			const stop = directory.store.subscribe(publish);
			publish();
			if (directory.store.getSnapshot().current === null) directory.load().catch(() => void 0);
			return stop;
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["sessions", "modelDirectories"];
		/** Debounce a reconcile through requestAnimationFrame (coalesce bursts). */
		function scheduleReconcile(fn) {
			let raf = 0;
			return () => {
				if (raf !== 0) return;
				raf = requestAnimationFrame(() => {
					raf = 0;
					fn();
				});
			};
		}
		/** Bounded DOM scan for session rows inside the sidebar browsing region. */
		function findSessionRows() {
			const found = [];
			for (const node of document.querySelectorAll("[role=\"treeitem\"]")) if (isSessionRow(node)) found.push(node);
			return found;
		}
		/** Locate or create the row's badge element (before the title). */
		function badgeOf(row) {
			return row.querySelector(`span[${BADGE_MARKER}]`);
		}
		/** Remove a pre-existing badge from the row, if any. */
		function removeBadge(row) {
			badgeOf(row)?.remove();
		}
		/** Reconcile one render pass: read list + selector state and sync every visible row. */
		function reconcileList(ctx, selected) {
			const list = ctx.sessions.list.getSnapshot();
			const bySession = providerBySession(list, selected);
			const index = providerTitleIndex(list);
			const used = /* @__PURE__ */ new Set();
			for (const row of findSessionRows()) try {
				const title = titleNodeOf(row);
				const sessionId = sessionIdOfRow(title, index, used);
				if (sessionId === void 0) {
					removeBadge(row);
					continue;
				}
				const projection = bySession.get(sessionId);
				if (projection === void 0) {
					removeBadge(row);
					continue;
				}
				const existing = badgeOf(row);
				if (existing !== null) {
					if (existing.dataset?.provider === projection.provider && existing.dataset?.model === projection.model && existing.title === badgeTitle(projection.provider, projection.model)) continue;
					existing.remove();
				}
				if (title === null) continue;
				const badge = document.createElement("span");
				badge.setAttribute(BADGE_MARKER, "");
				badge.dataset.provider = projection.provider;
				badge.dataset.model = projection.model;
				badge.title = badgeTitle(projection.provider, projection.model);
				badge.style.cssText = "display:inline-flex;align-items:center;margin-right:4px;line-height:0;flex:none";
				badge.innerHTML = badgeInnerHTML(projection.provider, projection.model);
				title.insertAdjacentElement?.("beforebegin", badge);
			} catch {}
		}
		function apply(ctx) {
			const observed = /* @__PURE__ */ new Set();
			const selected = /* @__PURE__ */ new Map();
			let observer = null;
			let selectedSessionId;
			let stopDirectory;
			const reconcile = scheduleReconcile(() => reconcileList(ctx, selected));
			const syncCurrentDirectory = () => {
				const id = ctx.sessions.list.getSnapshot().current;
				if (id === selectedSessionId) return;
				stopDirectory?.();
				stopDirectory = void 0;
				selectedSessionId = void 0;
				if (id === void 0) {
					reconcile();
					return;
				}
				try {
					stopDirectory = bindSelectionDirectory(id, (sessionId) => ctx.modelDirectories.directoryFor(sessionId), selected, reconcile);
					selectedSessionId = id;
				} catch {
					reconcile();
				}
			};
			const stop = () => {
				observer?.disconnect();
				observer = null;
				stopDirectory?.();
				stopDirectory = void 0;
				selectedSessionId = void 0;
				observed.clear();
			};
			ctx.effect(() => {
				const root = document.body;
				observer = new MutationObserver(() => {
					syncCurrentDirectory();
					reconcile();
				});
				observer.observe(root, {
					childList: true,
					subtree: true
				});
				observed.add(root);
				syncCurrentDirectory();
				reconcile();
				return () => {
					stop();
				};
			}, "sidebar-provider-icon: badge sync");
			ctx.effect(() => ctx.sessions.list.subscribe(() => {
				syncCurrentDirectory();
				reconcile();
			}), "sidebar-provider-icon: list + selected model sync");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map