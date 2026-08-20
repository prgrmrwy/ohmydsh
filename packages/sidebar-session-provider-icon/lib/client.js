window.__ModuleLoader__.load({
	id: "dsh-sidebar-session-provider-icon",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/provider-map.ts
		/**
		* Build the provider map from a sessions list snapshot. Rows without a
		* non-null `projectionValues.provider` (blank sessions, no-request sessions,
		* or assemblies where the unit is absent) are omitted.
		* @param list - sessions list snapshot (host rows + current).
		* @returns sessionId → provider projection for every known provider.
		*/
		function providerBySession(list) {
			const out = /* @__PURE__ */ new Map();
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0) continue;
				const p = summary.projectionValues?.provider;
				if (p !== void 0 && p !== null && typeof p.provider === "string" && p.provider !== "") out.set(id, p);
			}
			return out;
		}
		/**
		* Index session rows for reverse lookup by display title, limited to sessions
		* that have a provider (the only rows that render a badge). Keeps ids in list
		* order so duplicate-title resolution is deterministic; the caller advances
		* through candidates with a per-pass used set.
		* @param list - the sessions list snapshot.
		* @returns display title → session ids (list order), provider-bearing sessions only.
		*/
		function providerTitleIndex(list) {
			const out = /* @__PURE__ */ new Map();
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0) continue;
				const p = summary.projectionValues?.provider;
				if (p === void 0 || p === null) continue;
				const text = summary.displayTitle;
				if (text === "") continue;
				const bucket = out.get(text);
				if (bucket === void 0) out.set(text, [id]);
				else bucket.push(id);
			}
			return out;
		}
		/** Fallback color used for unknown providers (neutral slate, no brand implication). */
		const UNKNOWN_FILL = "#8a9199";
		/**
		* Normalize a provider id for matching: lowercase, strip common name-space
		* decorations (`@scope/` prefixes, `-` separators), so `@deepseek-ai/dsh-…`
		* adapter ids and `dsh-plugin-subscriptions` route ids both land on the same
		* brand key.
		* @param provider - raw provider id from the projection.
		* @returns normalized provider id (already trimmed/lowercased).
		*/
		function normalizeProviderId(provider) {
			return provider.trim().toLowerCase().replace(/^@[^/]+\//, "").replace(/^dsh[-_]?/i, "");
		}
		/** Find the brand key for a raw provider id, or undefined when unknown. */
		function brandKeyOf(provider) {
			const norm = normalizeProviderId(provider);
			if (norm.includes("codex") || norm.includes("openai") || norm.includes("gpt")) return "codex";
			if (norm.includes("claude") || norm.includes("anthropic")) return "claude";
			if (norm.includes("grok")) return "grok";
			if (norm.includes("deepseek")) return "deepseek";
		}
		/** Inline SVG viewBox fragments (24×24, scaled by the badge host). */
		const LOGO_SVGS = {
			claude: "<path fill=\"%fill%\" d=\"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Zm0 3.2 1.6 4.4L18 11l-4.4 1.4L12 16l-1.6-4.4L6 11l4.4-1.4L12 5.2Z\" fill-rule=\"evenodd\"/>",
			codex: "<path fill=\"%fill%\" d=\"M6 6 2 12l4 6h12l4-6-4-6H6Zm6 3.2 1.4 3.6 3.6 1.4-3.6 1.4L12 19.2l-1.4-3.6-3.6-1.4 3.6-1.4L12 9.2Z\" fill-rule=\"evenodd\"/>",
			grok: "<path fill=\"%fill%\" d=\"M13 2 4 14h6l-1 8 9-12h-6l1-8Z\" fill-rule=\"evenodd\"/>",
			deepseek: "<path fill=\"%fill%\" d=\"M12 3c-4 0-7 2.4-8 6 .5-1 1.6-1.6 3-1.6H9C8 5.6 9.2 4.6 12 4.6s4 1 3 2.8h2c1.4 0 2.5.6 3 1.6-1-3.6-4-6-8-6Z\" fill-rule=\"evenodd\"/>"
		};
		/** Brand → brand color (official-ish, hardcoded; no assets shipped). */
		const BRAND_COLORS = {
			claude: "#cc785c",
			codex: "#10a37f",
			grok: "#8b5cf6",
			deepseek: "#4d6bfe"
		};
		/**
		* Render the badge innerHTML for a provider/model pair. Unknown providers get
		* a neutral first-letter badge (no brand implication) with a `title` tooltip
		* carrying the raw provider/model so the identity stays transparent.
		* @param provider - raw provider id.
		* @param model - raw model id (or empty).
		* @returns innerHTML string for a 14px inline-flex badge span.
		*/
		function badgeInnerHTML(provider, model) {
			const key = brandKeyOf(provider);
			if (key !== void 0) {
				const fill = BRAND_COLORS[key] ?? UNKNOWN_FILL;
				return `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="display:block">${LOGO_SVGS[key].replace(/%fill%/g, fill)}</svg>`;
			}
			const letter = normalizeProviderId(provider).slice(0, 1).toUpperCase() || "?";
			return `<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:4px;background:${UNKNOWN_FILL};color:#fff;font-size:9px;line-height:1;font-weight:600">${letter}</span>`;
		}
		/** Human tooltip for the badge (shown when the row hovers). */
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
		//#region src/client/index.ts
		const inject = ["sessions"];
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
		/** Reconcile one render pass: read list state and sync every visible row. */
		function reconcileList(ctx) {
			const list = ctx.sessions.list.getSnapshot();
			const bySession = providerBySession(list);
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
			let observer = null;
			const reconcile = scheduleReconcile(() => reconcileList(ctx));
			const stop = () => {
				observer?.disconnect();
				observer = null;
				observed.clear();
			};
			ctx.effect(() => {
				const root = document.body;
				observer = new MutationObserver(() => reconcile());
				observer.observe(root, {
					childList: true,
					subtree: true
				});
				observed.add(root);
				reconcile();
				return () => {
					stop();
				};
			}, "sidebar-provider-icon: badge sync");
			ctx.effect(() => ctx.sessions.list.subscribe(() => reconcile()), "sidebar-provider-icon: list sync");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map