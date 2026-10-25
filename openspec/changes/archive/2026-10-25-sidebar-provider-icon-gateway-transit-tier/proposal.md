## Why

0.1.10 把网关会话的小图标改成了模型厂商（`dsh-magpie-connect / opencode-go/deepseek-v4.1-flash` → Magpie + DeepSeek），但 `<上游provider>/<model>` 里其实有**三层**身份：网关（Magpie）、中转平台（OpenCode）、模型厂商（DeepSeek）。现在中转层被完全丢弃，用户看不出这一轮是经 OpenCode 中转还是直连 DeepSeek —— 而这正是 Magpie 网关的一等配置维度。

复合 icon 的右下角位置已经用于模型厂商，左下角与其对称的位置目前是空的，可以直接承载中转层，不需要放大 badge 或改变行布局。

## What Changes

- 复合 icon 支持第三个位置：左下角（与右下角镜像对称）显示**中转层**品牌；右下角继续显示模型厂商，主图继续显示 provider route。
- 中转层只在网关型 route（Magpie）下、且模型 id 的 `/` 前段是**可识别品牌**时才出现（`opencode-go/deepseek-v4.1-flash` → 左下 OpenCode + 右下 DeepSeek）；上游段认不出（`auto/`、`group/`、`custom/`）时保持现有两层或单层，不显示中性首字母。
- 直连 route（`opencode-go/deepseek-v4.1-flash`、`traex/GPT-5.6-Sol` 等）的判定与渲染完全不变。
- 版本 0.1.10 → 0.1.11，同步 CHANGELOG、README（中英）、`dsh.yaml` 的 version 与 note。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `sidebar-session-provider-icon`：「使用下载落盘的真实品牌资产」补充网关下中转层的识别规则；「provider 与 model 品牌不同时显示复合 icon」扩展为最多三层：provider（主图）、中转平台（左下）、模型厂商（右下），并明确左下角不得侵占官方 StateDot。

## Impact

- 代码：`packages/sidebar-session-provider-icon/src/client/logos.ts`（品牌判定返回中转层，渲染新增左下角卫星图标），`test/logos.test.ts`。
- 文档：包内 `README.md` / `README.zh.md` 映射表与复合 icon 说明、`CHANGELOG.md`、`docs/screenshot.svg` 若有示例需同步。
- Manifest：`dsh.yaml` 该包 `version` 0.1.10 → 0.1.11，note 描述补「网关下三层」。
- 不影响 Host 侧投影、网络、凭据、行定位；不改变 badge 的行内占位尺寸（仍为 14×14，卫星图标溢出显示）。
- 回滚：`dsh.yaml` 版本改回 0.1.10 → `dsh build` → 刷新。
