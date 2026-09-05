## 1. 回归测试先行（锁住缺口）

- [ ] 1.1 在 `test/geo.test.ts` 增加失败用例：主端点挂起不返回直至超时、备端点健康且返回合法国家码 → 断言 `resolveCountry` 返回备端点结果且备端点确实被 fetch 过（当前实现下该用例 MUST 失败）
- [ ] 1.2 增加用例：调用方总 signal 在判定进行中 abort → 断言立即中止且不再尝试后续端点
- [ ] 1.3 增加用例：两个端点各自耗尽预算后均失败 → 断言返回 `null`（fail-closed 结论不变）
- [ ] 1.4 运行 `npm test`（package 内）确认 1.1 失败、1.2/1.3 行为符合预期，形成实施前的红灯基线

## 2. per-endpoint 超时隔离（D1）

- [ ] 2.1 `src/geo.ts`：`resolveCountry` 接受单端点预算参数，每次端点尝试用 `AbortSignal.any([callerSignal, AbortSignal.timeout(perEndpointMs)])` 组合信号传给 `fetch`
- [ ] 2.2 保留循环开头的调用方取消短路，但改为只检查调用方 signal，不因上一端点超时而短路后续端点
- [ ] 2.3 `src/network.ts`：`refresh()` 不再自建覆盖整次判定的 `AbortController` 超时；改为把单端点预算下传，调用方级取消能力保留
- [ ] 2.4 确认 `degradedReason` 的 `'timeout'` / `'invalid-response'` / `'fetch-failed'` 分类映射语义不变
- [ ] 2.5 运行 `npm test`，确认 1.1 由红转绿且既有用例全绿

## 3. 单端点内有限快速重试（D3）

- [ ] 3.1 `src/geo.ts`：对瞬时失败（transport 失败、非 2xx）在该端点预算内至多重试 1 次，前置约 150ms 固定退避
- [ ] 3.2 明确排除不可重试类别：端点自身超时、响应无 country 字段（确定性失败）
- [ ] 3.3 增加测试：首次 transport 失败、重试成功 → 采用主端点结果，且不触及备端点
- [ ] 3.4 增加测试：主端点自身超时 → 不在该端点重试，直接进入备端点（保证不侵占备端点预算）
- [ ] 3.5 确认 `NetworkVerdictCache` 的跨判定指数退避（2s→60s）逻辑与计数未被本次改动影响

## 4. Host gate 拒绝路径诊断（D4）

- [ ] 4.1 `src/egress-gate.ts`：`createEgressGate` 增加可选 `onReject` 回调，仅接收 `verdict` 与 `degradedReason` 两个已脱敏字段
- [ ] 4.2 保持 `EgressRestrictedError` 的 message 文本与拒绝条件 `result.verdict !== 'allowed'` 逐字不变
- [ ] 4.3 `src/index.ts`：在 `apply()` 根上下文（非 `ctx.inject(['connection'])` 分支内）接线 `ctx.logger`，使 headless 组合同样留下记录
- [ ] 4.4 拒绝日志去重：同 verdict 连续拒绝不重复输出，与 RPC 路径的 `logTransition` 各自独立计数
- [ ] 4.5 增加测试：gate 拒绝时 `onReject` 被调用且入参不含 IP/端点/响应体；非 Claude 调用不触发回调

## 5. 配置语义与文档

- [ ] 5.1 `src/config.ts`：更新 `timeoutMs` 的文档注释为「单端点预算」，确认默认值 5000 与校验逻辑无需变更
- [ ] 5.2 更新 package `README.md` 说明 `timeoutMs` 语义与最坏整体耗时约 `2 × timeoutMs`
- [ ] 5.3 更新 `dsh.yaml` 中 `home-network-model-guard` 的 note，记录 per-endpoint 超时、有限重试与拒绝日志

## 6. 验证与物化

- [ ] 6.1 package 内运行 `npm run typecheck` 与 `npm test` 全绿
- [ ] 6.2 仓库级运行 `npm test` 与 `npm run check:artifacts`
- [ ] 6.3 运行 `node scripts/sync.mjs` 物化，连续运行第二次确认无变化（幂等）
- [ ] 6.4 实机验证：重启 DSH 后确认当前出口判定为 `allowed`，Claude 可正常发送
- [ ] 6.5 实机验证故障转移：用本地 `config.json`（不进仓库）把主端点指向黑洞地址，确认备端点仍能放行且日志留下可复核记录
- [ ] 6.6 恢复本地 `config.json` 到原状（或删除），确认默认配置下行为正常
