window.__ModuleLoader__.load({
	id: "dsh-worktree-session",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/wire.ts
		/** Shared Worktree Session wire contract. This module has no runtime imports. */
		const ROUTES = {
			repoStatus: "/worktree-session/api/repo-status",
			start: "/worktree-session/api/start",
			operationStatus: "/worktree-session/api/operation-status",
			promote: "/worktree-session/api/promote",
			clean: "/worktree-session/api/clean",
			handoff: "/worktree-session/api/handoff"
		};
		//#endregion
		//#region src/client/api.ts
		async function post(path, body) {
			const payload = await (await fetch(path, {
				method: "POST",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			})).json();
			if (!payload.ok) throw Object.assign(new Error(payload.error.message), { wireError: payload.error });
			return payload.data;
		}
		//#endregion
		//#region src/client/stage-store.ts
		const stages = /* @__PURE__ */ new Map();
		const listeners = /* @__PURE__ */ new Map();
		function persistenceKey(sessionId) {
			return `dsh.worktree-session.v1.${sessionId}`;
		}
		function restore(sessionId, cwd) {
			try {
				const raw = localStorage.getItem(persistenceKey(sessionId));
				if (raw === null) return {};
				const value = JSON.parse(raw);
				if (value.cwd !== cwd) return {};
				return {
					enabled: value.enabled === true,
					...typeof value.baseRef === "string" ? { baseRef: value.baseRef } : {},
					...typeof value.operationId === "string" ? { operationId: value.operationId } : {},
					...typeof value.targetSessionId === "string" ? { targetSessionId: value.targetSessionId } : {},
					submitted: value.submitted === true
				};
			} catch {
				return {};
			}
		}
		function persist(stage) {
			try {
				localStorage.setItem(persistenceKey(stage.sessionId), JSON.stringify({
					cwd: stage.cwd,
					enabled: stage.enabled,
					baseRef: stage.baseRef,
					operationId: stage.operationId,
					targetSessionId: stage.targetSessionId,
					submitted: stage.submitted
				}));
			} catch {}
		}
		function getStage(sessionId, cwd) {
			const existing = stages.get(sessionId);
			if (existing !== void 0 && existing.cwd === cwd) return existing;
			const stage = {
				sessionId,
				cwd,
				enabled: false,
				refs: [],
				phase: "idle",
				submitted: false,
				...restore(sessionId, cwd)
			};
			stages.set(sessionId, stage);
			return stage;
		}
		function setStage(sessionId, cwd, patch) {
			const stage = {
				...getStage(sessionId, cwd),
				...patch,
				sessionId,
				cwd
			};
			stages.set(sessionId, stage);
			persist(stage);
			for (const listener of listeners.get(sessionId) ?? []) listener();
			return stage;
		}
		function resetStage(sessionId) {
			stages.delete(sessionId);
			try {
				localStorage.removeItem(persistenceKey(sessionId));
			} catch {}
			for (const listener of listeners.get(sessionId) ?? []) listener();
		}
		function subscribeStage(sessionId, listener) {
			const set = listeners.get(sessionId) ?? /* @__PURE__ */ new Set();
			set.add(listener);
			listeners.set(sessionId, set);
			return () => {
				set.delete(listener);
				if (set.size === 0) listeners.delete(sessionId);
			};
		}
		//#endregion
		//#region src/client/handoff.ts
		const decorations = /* @__PURE__ */ new Map();
		function operationId() {
			return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		}
		function summary(ctx, sessionId) {
			return ctx.sessions.list.getSnapshot().byId[sessionId];
		}
		async function waitForAdmission(ctx, sessionId, timeoutMs = 8e3) {
			if (summary(ctx, sessionId)?.blank === false) return true;
			return new Promise((resolvePromise) => {
				let settled = false;
				const finish = (value) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					unsubscribe();
					resolvePromise(value);
				};
				const unsubscribe = ctx.sessions.list.subscribe(() => {
					if (summary(ctx, sessionId)?.blank === false) finish(true);
				});
				const timer = setTimeout(() => finish(summary(ctx, sessionId)?.blank === false), timeoutMs);
			});
		}
		function liveImages(ctx, ids) {
			const controller = ctx.conversation;
			try {
				return controller.draftImages(ids).length === ids.length;
			} catch {
				return false;
			}
		}
		function preflight(ctx, input) {
			const state = input.state.getSnapshot();
			if (state.phase !== "plain" || state.claim !== void 0) throw new Error("Worktree start requires plain input with no active slash command");
			if (state.draft.trim() === "" && state.imageIds.length === 0) throw new Error("Enter a task before starting a Worktree Session");
			if (state.occurrences.length > 0) throw new Error("Remove @ references before starting a Worktree Session");
			if (!liveImages(ctx, state.imageIds)) throw new Error("One or more draft images are no longer available");
			return {
				text: state.draft,
				imageIds: state.imageIds
			};
		}
		async function runHandoff(ctx, sourceSessionId, cwd, mode, decoration) {
			const stage = getStage(sourceSessionId, cwd);
			if (!stage.enabled || stage.baseRef === void 0) {
				decoration.original.call(decoration.input, mode);
				return;
			}
			try {
				setStage(sourceSessionId, cwd, {
					phase: "validating",
					error: void 0
				});
				const snapshot = preflight(ctx, decoration.input);
				const id = stage.operationId ?? operationId();
				setStage(sourceSessionId, cwd, {
					operationId: id,
					phase: "host"
				});
				const request = {
					operationId: id,
					repoPath: cwd,
					baseRef: stage.baseRef,
					taskText: snapshot.text,
					dependencyMode: "lean"
				};
				const prepared = await post(ROUTES.start, request);
				setStage(sourceSessionId, cwd, { phase: prepared.phase });
				setStage(sourceSessionId, cwd, { phase: "workspace" });
				const workspace = await ctx.workspaces.create({ path: prepared.worktreePath });
				const targetId = await ctx.workspaces.connectWorkspace(workspace.workspaceId);
				const targetSessionId = targetId;
				await post(ROUTES.handoff, {
					operationId: id,
					repoPath: cwd,
					action: "bind-target",
					targetSessionId
				});
				setStage(sourceSessionId, cwd, { targetSessionId });
				if (summary(ctx, targetSessionId)?.blank === false) {
					await post(ROUTES.handoff, {
						operationId: id,
						repoPath: cwd,
						action: "admitted",
						targetSessionId
					});
					ctx.sessions.open(targetId);
					setStage(sourceSessionId, cwd, {
						phase: "done",
						submitted: true,
						enabled: false
					});
					decoration.restore();
					return;
				}
				if (getStage(sourceSessionId, cwd).submitted) {
					ctx.sessions.open(targetId);
					setStage(sourceSessionId, cwd, {
						phase: "uncertain",
						error: "Target submit was already attempted; review the target Session before retrying"
					});
					return;
				}
				const targetScope = ctx.sessions.scope(targetId);
				if (targetScope === void 0) throw new Error("Target Session scope is unavailable");
				const target = ctx.conversation.input.for(targetScope);
				setStage(sourceSessionId, cwd, { phase: "transfer" });
				if (snapshot.imageIds.length > 0 && !target.addImages(snapshot.imageIds)) throw new Error("Target Session refused draft images");
				target.setDraft(snapshot.text);
				ctx.sessions.open(targetId);
				if (!(await post(ROUTES.handoff, {
					operationId: id,
					repoPath: cwd,
					action: "claim-submit",
					targetSessionId
				})).submitAllowed) {
					ctx.sessions.open(targetId);
					setStage(sourceSessionId, cwd, {
						phase: "uncertain",
						submitted: true,
						error: "Target submit was already claimed durably; review the target Session before retrying"
					});
					decoration.restore();
					return;
				}
				setStage(sourceSessionId, cwd, {
					phase: "submit",
					submitted: true
				});
				target.submit(mode);
				if (!await waitForAdmission(ctx, targetSessionId)) {
					await post(ROUTES.handoff, {
						operationId: id,
						repoPath: cwd,
						action: "uncertain",
						targetSessionId
					});
					setStage(sourceSessionId, cwd, {
						phase: "uncertain",
						error: "Target admission is uncertain; the target draft is preserved and will not be auto-submitted again"
					});
					decoration.restore();
					return;
				}
				await post(ROUTES.handoff, {
					operationId: id,
					repoPath: cwd,
					action: "admitted",
					targetSessionId
				});
				decoration.input.setDraft("");
				for (const imageId of snapshot.imageIds) decoration.input.removeImage(imageId);
				setStage(sourceSessionId, cwd, {
					phase: "done",
					enabled: false,
					error: void 0
				});
				decoration.restore();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				decoration.input.notify("error", `Worktree Session: ${message}`);
				setStage(sourceSessionId, cwd, {
					phase: "error",
					error: message
				});
			}
		}
		function decorateSubmit(ctx, sessionId, cwd) {
			const existing = decorations.get(sessionId);
			if (existing !== void 0) return existing.restore;
			const scope = ctx.sessions.scope(sessionId);
			if (scope === void 0) throw new Error("Source Session scope is unavailable");
			const input = ctx.conversation.input.for(scope);
			const ownDescriptor = Object.getOwnPropertyDescriptor(input, "submit");
			const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "submit");
			if (ownDescriptor !== void 0 && ownDescriptor.writable === false || ownDescriptor === void 0 && !Object.isExtensible(input) || prototypeDescriptor?.writable === false) throw new Error("SessionInput.submit is not compatible with Worktree Session");
			const original = input.submit;
			const decoration = {
				input,
				original,
				...ownDescriptor === void 0 ? {} : { ownDescriptor },
				wrapper: (() => {}),
				restore() {
					if (decorations.get(sessionId) !== decoration) return;
					if (decoration.ownDescriptor === void 0) delete input.submit;
					else Object.defineProperty(input, "submit", decoration.ownDescriptor);
					decorations.delete(sessionId);
				}
			};
			decoration.wrapper = function submit(mode) {
				if (!getStage(sessionId, cwd).enabled) {
					original.call(input, mode);
					return;
				}
				if (decoration.flight !== void 0) return;
				decoration.flight = runHandoff(ctx, sessionId, cwd, mode, decoration).finally(() => {
					decoration.flight = void 0;
				});
			};
			Object.defineProperty(input, "submit", {
				configurable: true,
				enumerable: ownDescriptor?.enumerable ?? false,
				writable: true,
				value: decoration.wrapper
			});
			decorations.set(sessionId, decoration);
			return decoration.restore;
		}
		function restoreSubmit(sessionId) {
			decorations.get(sessionId)?.restore();
		}
		function restoreAllSubmits() {
			for (const decoration of [...decorations.values()]) decoration.restore();
		}
		//#endregion
		//#region src/client/controls.tsx
		const containerStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			fontSize: 12
		};
		const controlStyle = {
			border: "1px solid var(--dsw-alias-line-border, #d0d0d0)",
			borderRadius: 8,
			background: "transparent",
			color: "inherit",
			height: 26,
			maxWidth: 190
		};
		function WorktreeControls({ pluginContext: ctx, session, sessionId, useSessions }) {
			const cwd = useSessions((state) => state.byId[sessionId])?.cwd;
			const [revision, setRevision] = (0, react.useState)(0);
			const [query, setQuery] = (0, react.useState)("");
			const [open, setOpen] = (0, react.useState)(false);
			const stage = cwd === void 0 ? void 0 : getStage(sessionId, cwd);
			(0, react.useEffect)(() => subscribeStage(sessionId, () => {
				setRevision((value) => value + 1);
			}), [sessionId]);
			(0, react.useEffect)(() => {
				if (cwd === void 0 || !session.blank) {
					restoreSubmit(sessionId);
					return;
				}
				let live = true;
				post(ROUTES.repoStatus, { repoPath: cwd }).then((result) => {
					if (!live) return;
					const selected = getStage(sessionId, cwd).baseRef ?? result.currentBranch ?? result.refs[0]?.name;
					setStage(sessionId, cwd, {
						refs: result.refs,
						...selected === void 0 ? {} : { baseRef: selected }
					});
				}).catch(() => {
					if (live) resetStage(sessionId);
				});
				return () => {
					live = false;
					restoreSubmit(sessionId);
				};
			}, [
				ctx,
				cwd,
				session.blank,
				sessionId
			]);
			(0, react.useEffect)(() => {
				if (cwd === void 0 || stage === void 0 || !stage.enabled || !session.blank) {
					restoreSubmit(sessionId);
					return;
				}
				try {
					return decorateSubmit(ctx, sessionId, cwd);
				} catch (error) {
					setStage(sessionId, cwd, {
						enabled: false,
						phase: "error",
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}, [
				ctx,
				cwd,
				session.blank,
				sessionId,
				stage?.enabled
			]);
			const filtered = (0, react.useMemo)(() => (stage?.refs ?? []).filter((ref) => ref.name.toLowerCase().includes(query.toLowerCase())), [
				query,
				revision,
				stage?.refs
			]);
			if (cwd === void 0 || !session.blank || stage === void 0 || stage.refs.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: containerStyle,
				"data-testid": "worktree-session-controls",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: { position: "relative" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: {
								...controlStyle,
								padding: "0 8px"
							},
							title: "Choose the base ref; selection has no Git side effects",
							onClick: () => {
								const next = !open;
								setOpen(next);
								if (next) post(ROUTES.repoStatus, { repoPath: cwd }).then((result) => {
									setStage(sessionId, cwd, { refs: result.refs });
								});
							},
							children: [
								"⑂ ",
								stage.baseRef ?? "Choose base",
								" ▾"
							]
						}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								position: "absolute",
								bottom: 30,
								left: 0,
								zIndex: 1e3,
								width: 300,
								padding: 8,
								borderRadius: 10,
								background: "var(--dsw-alias-bg-layer-2, white)",
								boxShadow: "0 8px 30px #0003"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								autoFocus: true,
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
								},
								placeholder: "Search local and remote refs",
								style: {
									...controlStyle,
									boxSizing: "border-box",
									width: "100%",
									maxWidth: "none",
									padding: "0 7px"
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									display: "block",
									maxHeight: 230,
									overflow: "auto",
									marginTop: 6
								},
								children: ["local", "remote"].map((kind) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: { display: "block" },
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: {
											display: "block",
											padding: "5px 7px",
											opacity: .65
										},
										children: kind === "local" ? "Local" : "Remote"
									}), filtered.filter((ref) => ref.kind === kind).map((ref) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											display: "block",
											width: "100%",
											border: 0,
											background: ref.name === stage.baseRef ? "#3370ff22" : "transparent",
											color: "inherit",
											textAlign: "left",
											padding: "5px 7px",
											borderRadius: 6
										},
										onClick: () => {
											setStage(sessionId, cwd, { baseRef: ref.name });
											setOpen(false);
										},
										children: ref.name
									}, ref.fullName))]
								}, kind))
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-pressed": stage.enabled,
						style: {
							...controlStyle,
							padding: "0 8px",
							background: stage.enabled ? "#3370ff22" : "transparent"
						},
						onClick: () => {
							const enabled = !stage.enabled;
							setStage(sessionId, cwd, {
								enabled,
								phase: "idle",
								error: void 0,
								...enabled ? {} : {
									operationId: void 0,
									submitted: false,
									targetSessionId: void 0
								}
							});
							if (!enabled) restoreSubmit(sessionId);
						},
						children: [stage.enabled ? "☑" : "☐", " Worktree"]
					}),
					stage.phase !== "idle" && stage.phase !== "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: stage.error ?? stage.phase,
						style: {
							maxWidth: 180,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							color: stage.error ? "#d44" : "inherit",
							opacity: .8
						},
						children: stage.error ?? stage.phase
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"conversation"
		];
		function apply(ctx) {
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "worktree-session",
				order: 90,
				label: "Worktree Session"
			}, (props) => (0, react.createElement)(WorktreeControls, {
				...props,
				pluginContext: ctx
			})));
			ctx.effect(() => restoreAllSubmits, "worktree-session: restore submit decorations");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map