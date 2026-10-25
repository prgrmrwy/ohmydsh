## Why

经 Magpie 网关的会话，小图标显示的是**上游平台**（OpenCode）而不是**模型厂商**（DeepSeek）：真实会话 `dsh-magpie-connect / opencode-go/deepseek-v4.1-flash` 当前渲染为「Magpie + OpenCode」，用户看到 provider 已是 Magpie，却仍然显示 OpenCode，与 model 是 DeepSeek 的事实不符。

根因是 0.1.9 的网关解析顺序：`gatewayModelBrandOf` 先拿 `/` 前的上游段当 provider route 识别，命中即返回，`/` 后的模型名不再参与。而 `<上游provider>/<model>` 里的上游段正是**分发平台**，所以小图标复述了主图想区分的平台层，反而把真正的 model 身份吞掉了。放大小图标本是唯一显示 model 品牌的位置，这里被平台占用了。

## What Changes

- 网关型 route（Magpie）下的小图标判定反转为 **model 名优先**：先按 `/` 后的模型名识别厂商品牌（`opencode-go/deepseek-v4.1-flash` → DeepSeek）；模型名认不出时，才退回到把 `/` 前的上游段当 provider route 识别（`custom/gemini-3.5-flash` 这类仍能靠上游段或 model 名兜底）。
- 主图不变：provider route 是已知品牌（含 Magpie）时始终是主图，网关身份不丢失。
- 只对网关型 route 生效，直连 route（`opencode-go/deepseek-v4.1-flash`、`traex/GPT-5.6-Sol` 等）判定完全不变。
- 版本 0.1.9 → 0.1.10，同步 CHANGELOG、README（中英）、`dsh.yaml` 的 version 与 note。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `sidebar-session-provider-icon`: 「使用下载落盘的真实品牌资产」中网关型 route 的 model 品牌解析顺序由「上游段优先」改为「模型名优先、上游段兜底」；「provider 与 model 品牌不同时显示复合 icon」的 Magpie 场景同步改为子图标取模型厂商品牌。

## Impact

- 代码：`packages/sidebar-session-provider-icon/src/client/logos.ts`（`gatewayModelBrandOf`），`test/logos.test.ts`。
- 文档：包内 `README.md` / `README.zh.md` 的映射表与网关解析说明、`CHANGELOG.md`。
- Manifest：`dsh.yaml` 中该包 `version` 0.1.9 → 0.1.10，note 描述改为「按 model 厂商识别小图标」。
- 不影响 Host 侧投影、网络、凭据、行定位或复合 icon 的尺寸/布局。
- 回滚：`dsh.yaml` 版本改回 0.1.9 → `dsh build` → 重启。
