## MODIFIED Requirements

### Requirement: 选择器恢复官方单值 effort
宿主选择器 SHALL 使用官方 `0.2.0-rc.2` 原版的 ModelDirectory 与选择器，不得重新引入仅服务 actual/next 双值展示的 `lastUsed` 接缝、caption helper 或 locale。trigger、root effort 行和 menu SHALL 按官方 current 展示单一 effort，不出现「最近实际/下次」或 Last used/Next 这类双值文案。真实 provider/model 的 click、keyboard 和 effort 提交，以及 core modelSelection 投影，SHALL 保持官方行为。系统 MUST NOT 为 AUTO 维护选择器展示 patch，也不得手改 generated 目录。

#### Scenario: 单值 effort 与选择一致
- **GIVEN** 官方 current 为同模型 high（或手选 medium/low）
- **WHEN** 渲染 trigger、root effort 行和 effort menu
- **THEN** 只展示官方 current 的一个 effort，menu 勾选相同值；主动选择仍按原 provider/model 与选定 effort 提交，无展示写入

#### Scenario: 分组搜索与精确选择保留
- **GIVEN** 多个 Magpie 归属 route 与普通 provider 同时出现在原版选择器中
- **WHEN** 按模型名搜索（原版只按模型名匹配，不保证能按 id 或组名搜到），并用 click 或 keyboard 选中
- **THEN** 每个 route 各自成组，提交的 provider 就是该 route 的真实 id，effort 按官方 current 提交；宿主不加载任何展示分组 metadata
