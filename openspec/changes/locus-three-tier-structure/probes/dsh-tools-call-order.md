# dsh-tools rc.2 工具调用顺序摘录（2026-11-03）

来源：官方未打补丁包 `@deepseek-ai/dsh-tools@0.2.0-rc.2`，`lib/index.js`，sha256 `40f47709337c3c205d4e09e647f8588f4977e66f6d52f019b3cc7ef81159d84f`。评审子任务无法读取主 checkout 的 node_modules，故摘录于此。

```js
3218			if (this.callerCancelled(exec)) return next({
3219				kind: "final-result",
3220				exec,
3221				result: toolAbortedBeforeDispatchResult()
3222			});
3223			try {
3224				const carrier = scopeTarget(this, exec.agent);
3225				const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));
3226				const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : {
3227					decision: gate,
3228					approvalCancelled: false
3229				};
3230				const { decision } = askResolution;
3231				if (this.callerCancelled(exec) && askResolution.approvalCancelled) return await next({
3232					kind: "post-result",
3233					exec,
3234					result: toolAbortedBeforeDispatchResult()
3235				});
3236				if (decision.kind === "cancel") return await next({
3237					kind: "post-result",
3238					exec,
3239					result: toolAbortedBeforeDispatchResult()
3240				});
3241				const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;
3242				const denialInfo = decision.kind === "deny" ? decision.info : void 0;
3243				if (denialReason !== void 0) return await next({
3244					kind: "post-result",
3245					exec,
```

```js
3326		*/
3327		async dispatchScheduledExecution(exec) {
3328			try {
3329				const mutableExec = exec;
3330				const carrier = scopeTarget(this, exec.agent);
3331				const result = await this.ctx.waterfall(carrier, "tools/execute", mutableExec, () => this.dispatchToolBody(mutableExec));
3332				const normalized = this.normalizeDispatchResult(exec, result);
3333				const deferredContexts = this.deferredContexts.get(exec);
```

agent-loop 并行调度器使用的分阶段视图（prepare 含守卫判定，dispatch 进入 `tools/execute` 与工具体）：

```js
2673		/** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
2674		[TOOL_RUNTIME_SCHEDULER] = {
2675			prepare: (exec) => this.prepareScheduledExecution(exec),
2676			dispatch: (exec) => this.dispatchScheduledExecution(exec),
2677			finalize: (exec, result) => this.finalizeScheduledExecution(exec, result),
2678			finish: (exec, result) => this.finishScheduledExecution(exec, result)
2679		};
```

结论：守卫在可等待的 `tools/pre-execute`（含审批 ask）之后同步判定；判定到工具体之间只有两段可能等待：`tools/execute` 包装层，以及并行调度时 prepare 与 dispatch 之间等待并行名额。
