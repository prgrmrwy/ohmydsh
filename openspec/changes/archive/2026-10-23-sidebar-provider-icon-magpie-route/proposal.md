## Why

DSH 现在可以经 `dsh-magpie-connect` 插件接入家庭 Magpie 网关（CT105）。这个插件注册的 provider route 是 `dsh-magpie-connect`，模型 id 是网关的 `<上游provider>/<model>`，例如 `claude/claude-haiku-5-5`、`codex/gpt-6-luna`、`opencode-go/deepseek-v4-flash`（来自本机 cost-meter 台账的真实记录）。

侧边栏 provider 图标插件目前不认识这条 route：`normalizeIdentity` 会剥掉 `dsh-` 前缀，剩下的 `magpie-connect` 不匹配任何规则，于是回落到按 model 推断。结果是经网关的会话与直连会话**看起来完全一样**（都只显示 Anthropic 或 OpenAI），用户分不清这一轮到底走的是网关还是直连。对 `opencode-go/deepseek-v4-flash` 这类模型，还会把 DeepSeek 当主图，丢掉 OpenCode 与 Magpie 两层身份。

## What Changes

- 新增品牌 `magpie`：资产取自 magpie 官方仓库的 `internal/provider/magpie.svg`（MIT，按 commit 精确 pin，记录 SHA-256），与其它品牌一样随包落盘、运行时不访问外网。
- provider route 规则：`magpie`、`magpie-*`，以及插件 route `dsh-magpie-connect`（规范化后为 `magpie-connect`）都识别为 Magpie。按精确名或前缀匹配，不做子串匹配。
- 网关模型 id 的品牌识别：当 route 是 Magpie 时，model 的品牌先看 `/` 之前的上游 provider 段（`claude` → Anthropic、`codex` → OpenAI、`opencode-go` → OpenCode……），识别不出来再看 `/` 之后的模型名。这样 `dsh-magpie-connect / claude/claude-haiku-5-5` 显示为 Magpie 主图 + Anthropic 子图标。
- 复用现有复合 icon 机制：主图 Magpie，右下角子图标为上游品牌；上游无法识别时只显示 Magpie。tooltip 不变，仍显示精确的 `provider · model`。
- 版本 0.1.8 → 0.1.9，同步 `dsh.yaml`、CHANGELOG、README、资产出处与第三方声明。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `sidebar-session-provider-icon`：「使用下载落盘的真实品牌资产」增加 Magpie 品牌与 route 规则，以及网关型 route 下 `<上游>/<model>` 的品牌识别；「provider 与 model 品牌不同时显示复合 icon」增加 Magpie 场景。

## Impact

- 代码：`packages/sidebar-session-provider-icon/src/client/logos.ts`、`src/client/assets/magpie.svg`（新增）、`test/logos.test.ts`。
- 文档：包内 `README.md` / `README.zh.md`、`src/client/assets/README*.md`、`THIRD-PARTY-NOTICES.md`、`CHANGELOG.md`。
- Manifest：`dsh.yaml` 中该包 version 0.1.8 → 0.1.9。
- 不影响其它 route 的品牌判定（Magpie 规则只在 route 识别为 Magpie 时启用上游段解析）；不涉及 Host 侧投影、网络或凭据。
- 回滚：把 `dsh.yaml` 中该包 version 改回 0.1.8，然后 `dsh build`。
