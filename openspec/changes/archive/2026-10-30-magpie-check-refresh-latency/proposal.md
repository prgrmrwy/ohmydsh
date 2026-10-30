# Proposal

## Why

设置页的线路延迟是「打开面板时测一次、保存线路后再测一次」的 TCP 建连读数。用户点「检查线路」时其实已经在对同一条线路做一次真实网络请求，但延迟格不会更新，看起来像检查没有生效；想确认网络质量只能关掉面板再打开。

## What Changes

- **检查线路完成后刷新测速**：对**已保存**线路点击「检查线路」并拿到结果后，设置页重新请求一次 `GET /api/dsh-magpie-connector/latency`，让该行延迟格与其他已保存线路的读数一起更新（host 侧单飞，重复触发不会并发探测）。
- **未保存草稿不触发**：草稿没有 line id，延迟行本来就保持 `idle`，不额外发测速请求；也不为草稿新增「按地址测一次」的入参。
- **规范**：`magpie-line-selection` 的「线路测速范围与独立性」增加一个测速触发点（检查完成后），原有「不轮询、不持久化、只读、独立于自动选择」约束不变。

**不在本期范围**：未保存草稿的延迟展示、host 端点新增按显式地址测量的参数、任何轮询/定时刷新。

## Capabilities

### New Capabilities

<!-- 无新增能力 -->

### Modified Capabilities

- `magpie-line-selection`: 「线路测速范围与独立性」的触发条件增加「已保存线路的检查完成后重新测速一次」，并补一个对应场景；其余约束与场景不变。

## Impact

- `packages/dsh-magpie-connector/src/client/SettingsPage.ts`：把 `readLatency` 作为回调传给线路面板，`runCheck` 在结果落地后调用（仅 `draft.id` 存在时）。
- `packages/dsh-magpie-connector/test/line-check-ui.test.tsx`：新增测试「已保存线路检查后多一次 latency 请求；未保存草稿不触发」。
- 版本 0.4.1（patch）：`package.json`、`package-lock.json`、`dsh.yaml`、`CHANGELOG.md`。
- host 侧无改动，无设置 schema/凭据/接口变化；不需要 Host 重启即可在刷新设置页后生效。
