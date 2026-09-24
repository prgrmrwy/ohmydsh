# dsh-session-title-copy

在 DSH Web 对话区当前会话标题**右侧**显示 session id 前 6 位短标识徽标（去 `session-` 前缀，如 `session-9af69be9-…` → `9af69b`）；点击徽标复制**完整**当前 session id，hover 显示完整 id 的 tooltip，复制成功出现瞬态「会话 ID 已复制」提示。标题本身保持官方原样（disabled、cursor default）。

## 为什么

开发/调试时常需要当前 session id（引用驾驶舱、脚本、日志排查），官方标题是 `disabled` 按钮且 `cursor: default`，没有取 id 的入口。**v0.1.0 曾把标题做成点击复制**，实机反馈：点击前不可感知、复制内容不可见、面包屑作为导航控件点击语义违直觉——因此改为标题旁 6 位识别徽标：看得见、点得准、复制完整 id。零配置、零网络、零 host 端能力。

## 行为

- 标题面包屑右侧插入自建徽标（`data-dsh-session-title-copy-badge`）：显示当前 session id 的 6 位短标识（真相源 = 官方 sessions list 的 `current`，与 [dsh-cockpit-bridge](https://github.com/prgrmrwy/dsh-cockpit) 同一订阅 seam）。
- 点击徽标 → 复制**完整**当前 session id；hover → pointer + 底色 + tooltip 完整 id；复制成功徽标下方出现瞬态提示，1.2s 后淡出。
- 当前会话标题恢复官方原样：不干预（disabled、cursor default、无点击行为）。
- 祖先面包屑（历史会话标题）行为不变：点击仍打开对应会话，不复制。
- 会话切换/标题更新后徽标文本与复制目标跟随新当前 id；无标题（空白会话/hero）时不显示徽标。
- 安全降级：官方 DOM 结构变化导致无法定位插入点时不注入、不报错；剪贴板 API 不可用/被拒时静默；不发起任何网络请求，不读取/上传任何会话内容。

## 机制（升级后需回归）

标题 crumb 官方 `disabled`（抑制全部事件流），v0.1.0 曾移除此状态并拦截 click；**v0.1.1 起不再触碰标题**，交互完全落在自建徽标上：

1. 定位官方 titleCluster 内面包屑 `nav`（`title-locator.ts`，结构知识单文件）；
2. 在 `nav` 之后插入自建 `<button>` 徽标（自有标记 + 内联样式 + tooltip 完整 id）；
3. 点击 → `sessions.list` 的 `current` → `navigator.clipboard.writeText`（完整 id）→ 瞬态提示；
4. `MutationObserver`（子树/class 变更）+ sessions 订阅 → rAF 防抖 reconcile：存在即更新文本，缺失即重建，无标题区清除残留。

官方升级改结构时只需修 `src/client/title-locator.ts`（见 openspec change `session-title-id-badge` 设计 D1/D4）。

## 安装

经 ohmydsh manifest（`session-title-copy`，source: local）启用，`dsh build` 物化；重启 DSH 后生效。卸载/禁用：manifest `enabled: false` + sync，无持久化数据。

## 开发

```bash
npm run typecheck   # host + client 双项目
npm run build       # tsc(host) + tsdown(client bundle)
npm test            # vitest（结构桩，无浏览器）
```

peer 依赖：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-runtime`（仅 web client half）。
