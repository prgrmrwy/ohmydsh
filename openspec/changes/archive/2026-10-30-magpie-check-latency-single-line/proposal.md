# Proposal

## Why

0.4.1 让「检查线路」完成后重新测速，但请求的是全量 `GET latency`，于是**两条已保存线路的读数同时被刷新**。用户只检查了一条线路，另一条的延迟数字也跟着变，看起来像手动检查影响了不该动的行。同一个网络采样点不应改写其它行的展示。

## What Changes

- **按线路测速**：`GET /api/dsh-magpie-connector/latency?line=<id>` 只对指定已保存线路做一次 TCP 建连并只返回该行读数；不带 `line` 仍是原来的全量测速（打开面板、保存成功后使用）。host 侧按 scope 单飞，未知/未保存 id 不产生任何连接。
- **只更新该行**：客户端「检查线路」完成后用带 id 的请求刷新，把结果合并进现有读数表；其它行的 `data-latency-*` 保持不变。被刷新的行在请求期间显示 `measuring`（测速中…），其余行不闪烁。
- **规范**：`magpie-line-selection`「线路测速范围与独立性」把检查触发改为「只重新测速该线路」，并更新对应场景。

**不在本期范围**：未保存草稿的延迟展示；全量测速的触发点（打开面板、保存成功）不变。

## Capabilities

### Modified Capabilities

- `magpie-line-selection`: 「线路测速范围与独立性」——检查完成后只测该线路（请求带 id），其它行读数不变。

## Impact

- `packages/dsh-magpie-connector/src/host/latency.ts`：`read(lineId?)` 与按 scope 的单飞；`src/host/routes.ts` 把 `?line=` 传入。
- `packages/dsh-magpie-connector/src/client/latency.ts`、`src/client/SettingsPage.ts`：单行刷新与合并、行级 `measuring`。
- 测试：`test/latency.test.ts` 新增 `test_latency_single_line`；`test/line-check-ui.test.tsx` 的 `test_line_check_ui_06` 改为断言只刷该行、另一行不变。
- 版本 0.4.2（patch）；无 schema/凭据变化，旧 host 收到未知 query 只是全量测速（向后兼容，客户端不会因旧 host 报错）。
