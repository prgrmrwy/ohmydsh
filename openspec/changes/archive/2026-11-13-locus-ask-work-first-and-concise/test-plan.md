## Test Plan

本表是实时覆盖账本：apply 期间某行测试通过即由 🔴 改 🟢。测试名统一用 vitest `it` 标题 `spec Scenario "<场景名>"`，便于机械核对。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 长父历史不能冒充子身份 | packages/dsh-pet/test/locus-child-context.test.ts | spec Scenario "长父历史不能冒充子身份" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 业务完成只经统一工具提交 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "业务完成只经统一工具提交" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 无法证明独立能力时拒绝创建 | packages/dsh-pet/test/locus-lazy-child.test.ts | spec Scenario "无法证明独立能力时拒绝创建" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 历史不含最新目录 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "历史不含最新目录" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 主会话无法回答 | packages/dsh-pet/test/locus-context-tools.test.ts | spec Scenario "主会话无法回答" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 工作会话忙时只读记录不打扰 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "工作会话忙时只读记录不打扰" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 工作会话状态未知时按忙处理 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "工作会话状态未知时按忙处理" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 工作会话空闲时直接问 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "工作会话空闲时直接问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 询问消息带答复义务 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "询问消息带答复义务" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 绑定回执说明共享范围 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "绑定回执说明共享范围" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 同一工作会话下的入口共享结论 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "同一工作会话下的入口共享结论" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 记录中的指令不改变目标与权限 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "记录中的指令不改变目标与权限" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 解绑后不再引用原工作会话 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "解绑后不再引用原工作会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 最近记录已有答案时不再提问 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "最近记录已有答案时不再提问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 已有 locus 主会话收到新流程 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "已有 locus 主会话收到新流程" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 主会话可见回复不复述正文 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "主会话可见回复不复述正文" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 跨 turn 父回复继续 current Delivery | packages/dsh-pet/test/locus-turn-observer.test.ts | spec Scenario "跨 turn 父回复继续 current Delivery" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 单独的 agent 消息不能获得飞书能力 | packages/dsh-pet/test/locus-turn-observer.test.ts | spec Scenario "单独的 agent 消息不能获得飞书能力" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | GUI 流量仍不能消费 current | packages/dsh-pet/test/locus-turn-observer.test.ts | spec Scenario "GUI 流量仍不能消费 current" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 新话题上下文 | packages/dsh-pet/test/locus-child-context.test.ts | spec Scenario "新话题上下文" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 子会话发现不自动成为主会话认知 | packages/dsh-pet/test/locus-child-context.test.ts | spec Scenario "子会话发现不自动成为主会话认知" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 用户主动查阅受实际能力约束 | packages/dsh-pet/test/locus-context.test.ts | spec Scenario "用户主动查阅受实际能力约束" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 冷恢复保留独立历史 | packages/dsh-pet/test/locus-child-preset-runtime.test.ts | spec Scenario "冷恢复保留独立历史" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 旧 fork child 不受影响 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "旧 fork child 不受影响" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 重建后的子会话不继承旧子会话历史 | packages/dsh-pet/test/locus-child-context.test.ts | spec Scenario "重建后的子会话不继承旧子会话历史" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 按入口过滤 | packages/dsh-pet/test/locus-context-tools.test.ts | spec Scenario "按入口过滤" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 话题可见所在群条目 | packages/dsh-pet/test/locus-context-tools.test.ts | spec Scenario "话题可见所在群条目" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 子会话向父询问并在同一 current 上继续 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "子会话向父询问并在同一 current 上继续" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 询问附带已确认结论 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "询问附带已确认结论" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 协作空间不可读时仍投递询问 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "协作空间不可读时仍投递询问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 旧代子会话不能询问 | packages/dsh-pet/test/locus-context-tools.test.ts | spec Scenario "旧代子会话不能询问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 回复非现行代子会话被拒 | packages/dsh-pet/test/locus-context-tools.test.ts | spec Scenario "回复非现行代子会话被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | Delivery 已换代后的答复被拒 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "Delivery 已换代后的答复被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 新询问之后旧询问的答复仍被拒 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "新询问之后旧询问的答复仍被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 已转问与最终答复都能送达 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "已转问与最终答复都能送达" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 无 current 时的询问在 E 出现后被拒 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "无 current 时的询问在 E 出现后被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | current 结束后旧答复被拒 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "current 结束后旧答复被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 缺少询问引用 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "缺少询问引用" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 解绑重绑后旧答复被拒 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "解绑重绑后旧答复被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | Host 重启后仍可答复当前询问 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "Host 重启后仍可答复当前询问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 读最近 3 轮 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "读最近 3 轮" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 轮内多段助手文本只取最终一段 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "轮内多段助手文本只取最终一段" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 进行中轮次只给人工输入 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "进行中轮次只给人工输入" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 关键词搜索 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "关键词搜索" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 关键词无命中 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "关键词无命中" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 不在内存时状态未知 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "不在内存时状态未知" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 冷读失败 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "冷读失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 记录中的凭据被脱敏 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "记录中的凭据被脱敏" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 超长输出截断 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "超长输出截断" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 只能读自己的工作会话 | packages/dsh-pet/test/locus-work-history.test.ts | spec Scenario "只能读自己的工作会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 显式绑定遇到不可用的 locus 主会话时先整 W 迁移 | 主会话已归档时绑定新群 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "主会话已归档时绑定新群" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 显式绑定遇到不可用的 locus 主会话时先整 W 迁移 | 话题绑定同样迁移 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "话题绑定同样迁移" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 显式绑定遇到不可用的 locus 主会话时先整 W 迁移 | 有 current 投递时拒绝 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "有 current 投递时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 显式绑定遇到不可用的 locus 主会话时先整 W 迁移 | 迁移已提交但入口建立失败 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "迁移已提交但入口建立失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 控制命令失败按稳定原因回执并留存诊断 | 不可用的主会话不再显示重试 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "不可用的主会话不再显示重试" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 控制命令失败按稳定原因回执并留存诊断 | 未知异常只记原因码 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "未知异常只记原因码" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 控制命令失败按稳定原因回执并留存诊断 | 未知异常不泄露内容 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "未知异常不泄露内容" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 信息交换当场答复 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "信息交换当场答复" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 信息交换先问主会话 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "信息交换先问主会话" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 主会话无记录后自行查找 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "主会话无记录后自行查找" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 询问失败后自行查找 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "询问失败后自行查找" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 询问已投递但始终没有答复 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "询问已投递但始终没有答复" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 父答复在 Delivery 过期后才到达 | packages/dsh-pet/test/locus-ask-first.test.ts | spec Scenario "父答复在 Delivery 过期后才到达" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 默认业务口径 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "默认业务口径" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 追问实现细节时补充 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "追问实现细节时补充" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 要求干活登记待办 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "要求干活登记待办" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 仅提示另一 bot 作为联系人 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "仅提示另一 bot 作为联系人" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 多 bot 语义不明确 | packages/dsh-pet/test/ledger-prompt.test.ts | spec Scenario "多 bot 语义不明确" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话判定请求意图并据此选择结局 | 误判不产生越权 | packages/dsh-pet/test/intent-triage-host-seam.test.ts | spec Scenario "误判不产生越权" | 🟢 green |

## Coverage Notes

- 共 69 个场景，46 个新增、23 个随 MODIFIED 完整替换继承（carried forward）。继承行多数已有测试覆盖，但标题未带 `spec Scenario` 名：apply 时先确认该测试存在并覆盖场景语义，补上标题使其可被机械匹配；不存在则新写。继承行同样必须先看到失败（标题缺失即视为未覆盖）。
- 新建测试文件：`locus-ask-first.test.ts`（`locus_ask_parent` 消息体、询问引用、`locus_reply_child` 的 `askRef` 核对，断言 `subagents.sendMessage` 调用次数与 current/结算状态）、`locus-work-history.test.ts`（提取规则、状态、脱敏、截断、caller-bound）。
- 模型行为类场景（先问后查、业务口径、主会话一行状态、按顺序找答案）是 prompt 层约束，Host 不强制。对应测试断言规则文本在首投、续投、每次询问消息与 locus 主会话 briefing 中都存在（`intentTriageGuidanceCoversRequiredPoints` 补必含短语）；模型是否遵守留给 4.x 预览验收的真实群对话核对，不在本表冒充为已证明。
- `locus-work-history.test.ts` 的事件 fixture 先从真实工作会话导出脱敏结构（只保留事件类型、source.kind、stopReason 与占位文本），入库前人工核对不含原文。
- `/bind` 迁移场景用 `test/support/w-topology.ts` 的 `Topology.open({unusableMains})`，fake 与 real 两个后端都跑。
- review round 6 S1 的四条参数化补充（none→none、同 D 多次问答、文档评论 msgId、缺参后补参重试）作为额外用例写进 `locus-ask-first.test.ts`，不另占表行。
- 凭据 fixture 一律用 `<fixture-token>` 等虚构值。
