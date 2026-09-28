## 1. compat patch

- [x] 1.1 `types.ts`：`ContinuableStartSpec.agentPreset?`
- [x] 1.2 `continuation.ts`：`resolveIndependentPreset` 用于两处创建；非 independent 带 preset 时报 `INVALID_REQUEST`
- [x] 1.3 `continuation.ts`：`independentResumePreset` 用于两处冷恢复；缺 preset 时报 `NOT_RESUMABLE`
- [x] 1.4 `index.ts`：marker `supportsIndependentChildAgentPreset`
- [x] 1.5 上游测试：显式 preset 覆盖父 preset，冷恢复 mount 该 preset 且不调用 `composeFrom`；非 independent 被拒；marker 存在
- [x] 1.6 重新生成 patch，还原 `.upstream`，更新 `build.mjs` 与 `build-launcher.cjs` 的 hash 和 marker 校验，更新 README

## 2. Pet

- [x] 2.1 `aggregate.ts`：`LOCUS_CHILD_PRESET`；`LOCUS_MAIN_PRESET` 降级为自建主会话默认值
- [x] 2.2 `child.ts`：端口透传 `agentPreset`，要求新 marker，probe 诊断 `independent-child-preset-unavailable`
- [x] 2.3 `index.ts`：idle provisioning 门控新 marker
- [x] 2.4 `controller.ts`：删除 `requirePreset` 及 7 处调用参数
- [x] 2.5 `control.ts`、`dsh-port.ts`：注释与回执说明

## 3. 测试

- [x] 3.1 `locus-controller`：`/bind` 到 `standard` 或无 preset 的主会话成功
- [x] 3.2 `locus-child`：创建 spec 带 `agentPreset`；缺 marker 时拒绝创建、probe unavailable
- [x] 3.3 `loader-composition`：fake 带新 marker；注释改为 child preset

## 4. 验证与部署

- [x] 4.1 `compat/subagent/build.mjs` 通过（含上游测试与 marker 校验）
- [x] 4.2 Pet `typecheck` 与 `test`
- [x] 4.3 仓库 `npm test`、`npm run check:artifacts`，`node scripts/sync.mjs` 两次幂等
- [x] 4.4 经所有者同意后重启 Host，launcher 重建，在飞书群重新 `/bind` 验收
