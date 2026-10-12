## 1. 先写失败的测试

- [x] 1.1 `packages/sidebar-session-provider-icon/test/selection-binding.test.ts`：观测生命周期——同一个 session id 在 store 被替换后必须重订阅（旧订阅停止、新订阅生效、观测值立即变为新 store 的值）；store 快照变化但未推送时下一次 `sync()` 必须读到新值；视图切到另一个 session、目录不可解析、或没有打开 session 时必须丢弃观测值并停止订阅；解析失败可重试；目录 `current` 为空时触发一次 `load()` 并在发布后跟随。验证：旧实现（按 id 绑定一次、从不丢弃）下 4 条失败。
- [x] 1.2 `packages/sidebar-session-provider-icon/test/row-locator.test.ts`（provider-map 用例）：`modelSelection.next` 覆盖最近请求投影；`next` 缺失时回落到 `provider`；可核验的即时观测覆盖两者；两者都没有时不插入。验证：旧实现忽略 `modelSelection`，新用例失败。

## 2. 实现

- [x] 2.1 `src/client/selection-binding.ts`：以 `SelectionObservation` 取代按 id 绑定一次的 `bindSelectionDirectory`；每次 `sync()` 重新解析 store 身份，变化即重订阅并重读快照；观测值只在当前打开会话且目录可解析期间保留，否则丢弃。
- [x] 2.2 `src/client/provider-map.ts`：新增 `durableSelection()`，持久链顺序为 `modelSelection.next` → `provider`；即时观测仍优先。
- [x] 2.3 `src/client/index.ts`：列表订阅与 MutationObserver 两个信号统一调用 `syncObservation()`（`sync()` + reconcile），移除 `selectedSessionId` 短路与旧的绑定管理。验证：1.1、1.2 全绿。

## 3. 文档与收尾

- [x] 3.1 `README.md` / `README.zh.md` 行为章节：数据顺序（可核验的即时观测 → 选择意图 → 最近请求）与"观测值在离开会话后不再压住投影"的说明。
- [x] 3.2 `CHANGELOG.md` 0.1.6、`package.json` 与 `dsh.yaml` 版本 0.1.5 → 0.1.6、`dsh.yaml` note 同步。
- [x] 3.3 包内 `vitest run`、host/client `tsc --noEmit`、包 `npm run build`、`openspec validate --strict sidebar-provider-icon-selection-freshness`。
- [x] 3.4 部署后真机复核（须先由用户批准合入并从主 checkout sync）：把某会话从 Claude 系切到 `codex/gpt-6.1-sol`，其侧边栏行应即时变为 OpenAI 图标；离开该会话再回列表仍显示新选择，不需要刷新页面。验证：2026-10-12/13 部署 0.1.6+0.1.7 后由所有者验收通过；同名会话（`session-a1f7a6e8` 与 flow-web-monorepo 的 7 小时前会话）各显示自己的品牌，不再互换。
