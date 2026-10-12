## Why

2026-10-12 实机：会话 `session-a1f7a6e8` 已从 `claude/claude-opus-5-5` 切到 `codex/gpt-6.1-sol`，Host 侧该会话的 `provider` 与 `modelSelection` 投影都已是 `codex/gpt-6.1-sol`，但侧边栏该行仍显示 Anthropic 图标，刷新页面才恢复。

两个原因都在客户端把"即时选择"当成了永久事实：

- 官方 `ModelDirectory.store` 属于客户端 Session scope，scope 回收后再物化会给同一个 session id 一个**新的** store，而退役的 store 永不再推送。旧实现按 session id 记忆"已绑定"（`id === selectedSessionId` 直接 return），于是一直监听已冻结的旧 store；同时观测值在 `providerBySession` 中优先于持久投影，一个**无法再核验**的旧值就永久压住了正确的投影。
- 观测值只为"当前打开的 session"建立，但离开会话后既不丢弃、也不可能再核验；而持久 fallback 只有"最近一次实际请求"一种，无法表达"已选未发送"的选择（规范里「selector 覆盖旧投影」正是这种场景）。

## What Changes

- **观测生命周期按 store 身份绑定**：每次会话列表 / DOM 信号重新解析当前打开 session 的目录；store 身份变化即重订阅并重读快照。未推送的变化（以及任何被漏掉的发布）在下一次信号自愈。
- **观测值可核验才生效**：观测值只在其 session 是当前打开会话、且目录仍可解析期间有效；视图离开或目录不再可解析时丢弃，改由持久投影回答。不得让无法核验的旧观测值继续覆盖投影。
- **持久 fallback 两级**：优先官方 `modelSelection` 投影的 `next`（该 session 下一次请求将使用的选择，含已选未发送），其次才是本插件的最近一次实际请求投影；两者都缺时仍不插入 logo。
- 其余行为不变：即时观测仍优先；`session.selectModel` 失败仍显示已确认的旧选择；品牌资产、row-locator 的 DOM 假设、Host 侧投影定义均不动。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `sidebar-session-provider-icon`：修改「输入框当前模型选择为活动会话的 logo 真相源」（订阅按 store 身份重解析、观测值可核验才生效）与「最后实际请求投影仅作冷历史 fallback」（持久 fallback 改为选择意图 → 最近请求的两级顺序）。

## Impact

- 代码：`packages/sidebar-session-provider-icon/src/client/selection-binding.ts`（观测生命周期）、`provider-map.ts`（持久链）、`index.ts`（接线）。
- 测试：`test/selection-binding.test.ts`（观测生命周期：代际替换、自愈、丢弃、重试）、`test/row-locator.test.ts` 的 provider-map 用例（持久链顺序）。
- 文档：包内 `README.md` / `README.zh.md` 行为章节、`CHANGELOG.md` 0.1.6；`dsh.yaml` 条目 note。
- 部署：本 change 与 `ws/claude-sol` 分支的 `home-network-model-guard` 修复同批，部署须从主 checkout 执行 sync（worktree sync 的路径与清空产物风险见 BACKLOG D004/D007）。
