# 实施任务

WHAT 以 delta spec 为准，HOW 以 design 为准。

## 1. 接缝探针（已执行）

- [x] 1.1 运行 `scripts/probe-managed-identity.mjs`：证实同窗口服务直建旁支与工具目标不可区分（见 implementation-progress.md）；用户 2026-10-28 接受该限制，D1 已修订。

## 2. 官方工具创建的子会话受管

- [x] 2.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-001 官方工具创建的子会话受管`，记录正确原因的 red（已有回归记录基线）。
- [x] 2.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 2.1 通过。
- [x] 2.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 3. 插件直接创建的子会话原样放行

- [x] 3.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-002 插件直接创建的子会话原样放行`，记录正确原因的 red（已有回归记录基线）。
- [x] 3.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 3.1 通过。
- [x] 3.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 4. MANUAL 时创建的子会话在切到 AUTO 后仍放行

- [x] 4.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-003 MANUAL 时创建的子会话在切到 AUTO 后仍放行`，记录正确原因的 red（已有回归记录基线）。
- [x] 4.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 4.1 通过。
- [x] 4.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 5. fork 子会话与父会话一致

- [x] 5.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-004 fork 子会话与父会话一致`，记录正确原因的 red（已有回归记录基线）。
- [x] 5.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 5.1 通过。
- [x] 5.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 6. 孙会话以直接父会话为锚

- [x] 6.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-005 孙会话以直接父会话为锚`，记录正确原因的 red（已有回归记录基线）。
- [x] 6.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 6.1 通过。
- [x] 6.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 7. 创建期间根会话离开 AUTO 则不受管

- [x] 7.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-006 创建期间根会话离开 AUTO 则不受管`，记录正确原因的 red（已有回归记录基线）。
- [x] 7.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 7.1 通过。
- [x] 7.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 8. 恢复通知不重写已有绑定

- [x] 8.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-007 恢复通知不重写已有绑定`，记录正确原因的 red（已有回归记录基线）。
- [x] 8.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 8.1 通过。
- [x] 8.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 9. 工具窗口外创建的插件子会话不被接管

- [x] 9.1 编写或强化 `packages/auto-model-routing/test/official-child-identity.integration.test.ts` 中 `AMR-008 工具窗口外创建的插件子会话不被接管`，记录正确原因的 red（已有回归记录基线）。
- [x] 9.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 9.1 通过。
- [x] 9.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 10. 同窗口同父插件旁支一并受管且如实说明

- [x] 10.1 编写或强化 `packages/auto-model-routing/test/official-child-identity.integration.test.ts` 中 `AMR-009 同窗口同父插件旁支一并受管且如实说明`，记录正确原因的 red（已有回归记录基线）。
- [x] 10.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 10.1 通过。
- [x] 10.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 11. provider 与父配置在绑定边界同步采样

- [x] 11.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-010 provider 与父配置在绑定边界同步采样`，记录正确原因的 red（已有回归记录基线）。
- [x] 11.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 11.1 通过。
- [x] 11.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 12. 新初始记录缺少父快照被拒

- [x] 12.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-011 新初始记录缺少父快照被拒`，记录正确原因的 red（已有回归记录基线）。
- [x] 12.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 12.1 通过。
- [x] 12.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 13. 受管子会话完整性问题仍拒绝

- [x] 13.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-012 受管子会话完整性问题仍拒绝`，记录正确原因的 red（已有回归记录基线）。
- [x] 13.2 实现「AUTO 受管子会话范围」中该场景所需的最小行为，使 13.1 通过。
- [x] 13.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 14. 能力槽可用时按能力选模

- [x] 14.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-013 能力槽可用时按能力选模`，记录正确原因的 red（已有回归记录基线）。
- [x] 14.2 实现「子任务路由退化链」中该场景所需的最小行为，使 14.1 通过。
- [x] 14.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 15. provider 没有能力槽模型时保持父模型

- [x] 15.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-014 provider 没有能力槽模型时保持父模型`，记录正确原因的 red（已有回归记录基线）。
- [x] 15.2 实现「子任务路由退化链」中该场景所需的最小行为，使 15.1 通过。
- [x] 15.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 16. 父模型不在允许列表时不改写

- [x] 16.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-015 父模型不在允许列表时不改写`，记录正确原因的 red（已有回归记录基线）。
- [x] 16.2 实现「子任务路由退化链」中该场景所需的最小行为，使 16.1 通过。
- [x] 16.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 17. depth effort 不可得时用父会话 effort

- [x] 17.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-016 depth effort 不可得时用父会话 effort`，记录正确原因的 red（已有回归记录基线）。
- [x] 17.2 实现「子任务路由退化链」中该场景所需的最小行为，使 17.1 通过。
- [x] 17.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 18. 父会话 effort 也不可用时不改写并告警

- [x] 18.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-017 父会话 effort 也不可用时不改写并告警`，记录正确原因的 red（已有回归记录基线）。
- [x] 18.2 实现「子任务路由退化链」中该场景所需的最小行为，使 18.1 通过。
- [x] 18.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 19. 子任务 Jev 失败不改写

- [x] 19.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-018 子任务 Jev 失败不改写`，记录正确原因的 red（已有回归记录基线）。
- [x] 19.2 实现「子任务路由退化链」中该场景所需的最小行为，使 19.1 通过。
- [x] 19.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 20. 显式维度不可用时不替换

- [x] 20.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-019 显式维度不可用时不替换`，记录正确原因的 red（已有回归记录基线）。
- [x] 20.2 实现「子任务路由退化链」中该场景所需的最小行为，使 20.1 通过。
- [x] 20.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 21. 只显式 effort 时能力槽须支持该 effort

- [x] 21.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-020 只显式 effort 时能力槽须支持该 effort`，记录正确原因的 red（已有回归记录基线）。
- [x] 21.2 实现「子任务路由退化链」中该场景所需的最小行为，使 21.1 通过。
- [x] 21.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 22. 不改写的记录在重启后不重判

- [x] 22.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-021 不改写的记录在重启后不重判`，记录正确原因的 red（已有回归记录基线）。
- [x] 22.2 实现「子任务路由退化链」中该场景所需的最小行为，使 22.1 通过。
- [x] 22.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 23. 矛盾的记录组合被拒绝

- [x] 23.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-022 矛盾的记录组合被拒绝`，记录正确原因的 red（已有回归记录基线）。
- [x] 23.2 实现「子任务路由退化链」中该场景所需的最小行为，使 23.1 通过。
- [x] 23.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 24. 冷恢复时初始决策中断

- [x] 24.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-023 冷恢复时初始决策中断`，记录正确原因的 red（已有回归记录基线）。
- [x] 24.2 实现「子任务路由退化链」中该场景所需的最小行为，使 24.1 通过。
- [x] 24.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 25. 已有 route 实时门禁失败仍拒绝

- [x] 25.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-024 已有 route 实时门禁失败仍拒绝`，记录正确原因的 red（已有回归记录基线）。
- [x] 25.2 实现「子任务路由退化链」中该场景所需的最小行为，使 25.1 通过。
- [x] 25.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 26. 子判断期间模式往返使旧结果失效

- [x] 26.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-025 子判断期间模式往返使旧结果失效`，记录正确原因的 red（已有回归记录基线）。
- [x] 26.2 实现「子任务路由退化链」中该场景所需的最小行为，使 26.1 通过。
- [x] 26.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 27. 未路由告警可见且只提示一次

- [x] 27.1 编写或强化 `packages/auto-model-routing/test/child-notice.integration.test.ts` 中 `AMR-026 未路由告警可见且只提示一次`，记录正确原因的 red（已有回归记录基线）。
- [x] 27.2 实现「子任务未路由告警」中该场景所需的最小行为，使 27.1 通过。
- [x] 27.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 28. 告警不泄漏任务文本且开关关闭不弹出

- [x] 28.1 编写或强化 `packages/auto-model-routing/test/child-notice.integration.test.ts` 中 `AMR-027 告警不泄漏任务文本且开关关闭不弹出`，记录正确原因的 red（已有回归记录基线）。
- [x] 28.2 实现「子任务未路由告警」中该场景所需的最小行为，使 28.1 通过。
- [x] 28.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 29. 子会话不渲染芯片且停止轮询

- [x] 29.1 编写或强化 `packages/auto-model-routing/test/child-chip.dom.test.ts` 中 `AMR-028 子会话不渲染芯片且停止轮询`，记录正确原因的 red（已有回归记录基线）。
- [x] 29.2 实现「子会话不显示 AUTO 芯片」中该场景所需的最小行为，使 29.1 通过。
- [x] 29.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 30. 带旧 AUTO 状态的子会话不被改写

- [x] 30.1 编写或强化 `packages/auto-model-routing/test/host.integration.test.ts` 中 `AMR-029 带旧 AUTO 状态的子会话不被改写`，记录正确原因的 red（已有回归记录基线）。
- [x] 30.2 实现「子会话不显示 AUTO 芯片」中该场景所需的最小行为，使 30.1 通过。
- [x] 30.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 31. 状态读取失败的普通会话保持原行为

- [x] 31.1 编写或强化 `packages/auto-model-routing/test/child-chip.dom.test.ts` 中 `AMR-030 状态读取失败的普通会话保持原行为`，记录正确原因的 red（已有回归记录基线）。
- [x] 31.2 实现「子会话不显示 AUTO 芯片」中该场景所需的最小行为，使 31.1 通过。
- [x] 31.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 32. 内置注册表可构造且不含 provider 知识

- [x] 32.1 编写或强化 `packages/auto-model-routing/test/strategies.test.ts` 中 `AMR-031 内置注册表可构造且不含 provider 知识`，记录正确原因的 red（已有回归记录基线）。
- [x] 32.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 32.1 通过。
- [x] 32.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 33. 冲突的注册表拒绝构造

- [x] 33.1 编写或强化 `packages/auto-model-routing/test/strategies.test.ts` 中 `AMR-032 冲突的注册表拒绝构造`，记录正确原因的 red（已有回归记录基线）。
- [x] 33.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 33.1 通过。
- [x] 33.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 34. effort 起点按模型名查找且保持原结果

- [x] 34.1 编写或强化 `packages/auto-model-routing/test/strategies.test.ts` 中 `AMR-033 effort 起点按模型名查找且保持原结果`，记录正确原因的 red（已有回归记录基线）。
- [x] 34.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 34.1 通过。
- [x] 34.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 35. effort 边界保持原结果

- [x] 35.1 编写或强化 `packages/auto-model-routing/test/strategies.test.ts` 中 `AMR-034 effort 边界保持原结果`，记录正确原因的 red（已有回归记录基线）。
- [x] 35.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 35.1 通过。
- [x] 35.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 36. 新增家族只需新增策略

- [x] 36.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-035 新增家族只需新增策略`，记录正确原因的 red（已有回归记录基线）。
- [x] 36.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 36.1 通过。
- [x] 36.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 37. 记录中的家族已不在注册表

- [x] 37.1 编写或强化 `packages/auto-model-routing/test/strategies.test.ts` 中 `AMR-036 记录中的家族已不在注册表`，记录正确原因的 red（已有回归记录基线）。
- [x] 37.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 37.1 通过。
- [x] 37.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 38. 家族知识只有一个来源

- [x] 38.1 编写或强化 `packages/auto-model-routing/test/strategies.test.ts` 中 `AMR-037 家族知识只有一个来源`，记录正确原因的 red（已有回归记录基线）。
- [x] 38.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 38.1 通过。
- [x] 38.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 39. 未登记的 provider 不被枚举拒绝

- [x] 39.1 编写或强化 `packages/auto-model-routing/test/strategies.test.ts` 中 `AMR-038 未登记的 provider 不被枚举拒绝`，记录正确原因的 red（已有回归记录基线）。
- [x] 39.2 实现「模型家族策略注册表」中该场景所需的最小行为，使 39.1 通过。
- [x] 39.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 40. 内置子路由与原行为一致

- [x] 40.1 编写或强化 `packages/auto-model-routing/test/routing.test.ts` 中 `AMR-039 内置子路由与原行为一致`，记录正确原因的 red（已有回归记录基线）。
- [x] 40.2 实现「内置模型家族策略」中该场景所需的最小行为，使 40.1 通过。
- [x] 40.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 41. 能力槽只在父 provider 内解析

- [x] 41.1 编写或强化 `packages/auto-model-routing/test/routing.test.ts` 中 `AMR-040 能力槽只在父 provider 内解析`，记录正确原因的 red（已有回归记录基线）。
- [x] 41.2 实现「内置模型家族策略」中该场景所需的最小行为，使 41.1 通过。
- [x] 41.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 42. 能力槽须与父模型前缀相同

- [x] 42.1 编写或强化 `packages/auto-model-routing/test/routing.test.ts` 中 `AMR-041 能力槽须与父模型前缀相同`，记录正确原因的 red（已有回归记录基线）。
- [x] 42.2 实现「内置模型家族策略」中该场景所需的最小行为，使 42.1 通过。
- [x] 42.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 43. AUTO 不改主 provider/model

- [x] 43.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-042 AUTO 不改主 provider/model`，记录正确原因的 red（已有回归记录基线）。
- [x] 43.2 实现「手动隔离与失败可见」中该场景所需的最小行为，使 43.1 通过。
- [x] 43.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 44. 子失败不换模且可见

- [x] 44.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-043 子失败不换模且可见`，记录正确原因的 red（已有回归记录基线）。
- [x] 44.2 实现「手动隔离与失败可见」中该场景所需的最小行为，使 44.1 通过。
- [x] 44.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 45. GPT 主子保持同 transport 及支持的 effort

- [x] 45.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-044 GPT 主子保持同 transport 及支持的 effort`，记录正确原因的 red（已有回归记录基线）。
- [x] 45.2 实现「Magpie 兼容不扩大权限与能力范围」中该场景所需的最小行为，使 45.1 通过。
- [x] 45.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 46. 更新全局目录不能扩大父 captured allowlist

- [x] 46.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-045 更新全局目录不能扩大父 captured allowlist`，记录正确原因的 red（已有回归记录基线）。
- [x] 46.2 实现「Magpie 兼容不扩大权限与能力范围」中该场景所需的最小行为，使 46.1 通过。
- [x] 46.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 47. 各状态码映射为闭集类别

- [x] 47.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-046 各状态码映射为闭集类别`，记录正确原因的 red（已有回归记录基线）。
- [x] 47.2 实现「Jev 失败即停用并提示」中该场景所需的最小行为，使 47.1 通过。
- [x] 47.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 48. 停用后不再调用 Jev 且不改写

- [x] 48.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-047 停用后不再调用 Jev 且不改写`，记录正确原因的 red（已有回归记录基线）。
- [x] 48.2 实现「Jev 失败即停用并提示」中该场景所需的最小行为，使 48.1 通过。
- [x] 48.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 49. 用户重新点 AUTO 清除停用

- [x] 49.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-048 用户重新点 AUTO 清除停用`，记录正确原因的 red（已有回归记录基线）。
- [x] 49.2 实现「Jev 失败即停用并提示」中该场景所需的最小行为，使 49.1 通过。
- [x] 49.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 50. 用户取消不是失败

- [x] 50.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-049 用户取消不是失败`，记录正确原因的 red（已有回归记录基线）。
- [x] 50.2 实现「Jev 失败即停用并提示」中该场景所需的最小行为，使 50.1 通过。
- [x] 50.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 51. 凭据与响应体不泄漏

- [x] 51.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-050 凭据与响应体不泄漏`，记录正确原因的 red（已有回归记录基线）。
- [x] 51.2 实现「Jev 失败即停用并提示」中该场景所需的最小行为，使 51.1 通过。
- [x] 51.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 52. 子任务判断失败不停用根会话

- [x] 52.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-051 子任务判断失败不停用根会话`，记录正确原因的 red（已有回归记录基线）。
- [x] 52.2 实现「Jev 失败即停用并提示」中该场景所需的最小行为，使 52.1 通过。
- [x] 52.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 53. 无效会话被拒绝且无副作用

- [x] 53.1 编写或强化 `packages/auto-model-routing/test/endpoints.test.ts` 中 `AMR-052 无效会话被拒绝且无副作用`，记录正确原因的 red（已有回归记录基线）。
- [x] 53.2 实现「Host 端点边界」中该场景所需的最小行为，使 53.1 通过。
- [x] 53.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 54. 只修改目标会话

- [x] 54.1 编写或强化 `packages/auto-model-routing/test/endpoints.test.ts` 中 `AMR-053 只修改目标会话`，记录正确原因的 red（已有回归记录基线）。
- [x] 54.2 实现「Host 端点边界」中该场景所需的最小行为，使 54.1 通过。
- [x] 54.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 55. label 响应以绑定是否存在区分

- [x] 55.1 编写或强化 `packages/auto-model-routing/test/endpoints.test.ts` 中 `AMR-054 label 响应以绑定是否存在区分`，记录正确原因的 red（已有回归记录基线）。
- [x] 55.2 实现「Host 端点边界」中该场景所需的最小行为，使 55.1 通过。
- [x] 55.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 56. 子会话状态返回不适用

- [x] 56.1 编写或强化 `packages/auto-model-routing/test/endpoints.test.ts` 中 `AMR-055 子会话状态返回不适用`，记录正确原因的 red（已有回归记录基线）。
- [x] 56.2 实现「Host 端点边界」中该场景所需的最小行为，使 56.1 通过。
- [x] 56.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 57. 环境级指令含派发规则且不含模型名

- [x] 57.1 编写或强化 `tests/agent-instructions-dispatch.test.mjs` 中 `AMR-056 环境级指令含派发规则且不含模型名`，记录正确原因的 red（已有回归记录基线）。
- [x] 57.2 实现「子会话派发时机写入环境级指令」中该场景所需的最小行为，使 57.1 通过。
- [x] 57.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 58. 指令不要求把预览结果当显式参数

- [x] 58.1 编写或强化 `tests/agent-instructions-dispatch.test.mjs` 中 `AMR-057 指令不要求把预览结果当显式参数`，记录正确原因的 red（已有回归记录基线）。
- [x] 58.2 实现「子会话派发时机写入环境级指令」中该场景所需的最小行为，使 58.1 通过。
- [x] 58.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 59. 干净安装获得唯一 skill

- [x] 59.1 编写或强化 `packages/auto-model-routing/test/bundled-skill.integration.test.ts` 中 `AMR-058 干净安装获得唯一 skill`，记录正确原因的 red（已有回归记录基线）。
- [x] 59.2 实现「插件安装自包含配套 skill」中该场景所需的最小行为，使 59.1 通过。
- [x] 59.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 60. skill 只含当前用法

- [x] 60.1 编写或强化 `packages/auto-model-routing/test/bundled-skill.integration.test.ts` 中 `AMR-059 skill 只含当前用法`，记录正确原因的 red（已有回归记录基线）。
- [x] 60.2 实现「插件安装自包含配套 skill」中该场景所需的最小行为，使 60.1 通过。
- [x] 60.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 61. 旧部署迁移无重复来源

- [x] 61.1 编写或强化 `packages/auto-model-routing/test/bundled-skill.integration.test.ts` 中 `AMR-060 旧部署迁移无重复来源`，记录正确原因的 red（已有回归记录基线）。
- [x] 61.2 实现「插件安装自包含配套 skill」中该场景所需的最小行为，使 61.1 通过。
- [x] 61.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 62. 插件禁用撤销 skill 与工具

- [x] 62.1 编写或强化 `packages/auto-model-routing/test/bundled-skill.integration.test.ts` 中 `AMR-061 插件禁用撤销 skill 与工具`，记录正确原因的 red（已有回归记录基线）。
- [x] 62.2 实现「插件安装自包含配套 skill」中该场景所需的最小行为，使 62.1 通过。
- [x] 62.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 63. 切换到不支持的主模型自动锁定

- [x] 63.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-062 切换到不支持的主模型自动锁定`，记录正确原因的 red（已有回归记录基线）。
- [x] 63.2 实现「AUTO 主模型支持范围与不可用锁定」中该场景所需的最小行为，使 63.1 通过。
- [x] 63.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 64. 不支持模型的请求不再导致整轮失败

- [x] 64.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-063 不支持模型的请求不再导致整轮失败`，记录正确原因的 red（已有回归记录基线）。
- [x] 64.2 实现「AUTO 主模型支持范围与不可用锁定」中该场景所需的最小行为，使 64.1 通过。
- [x] 64.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 65. 芯片锁定态与悬停提示

- [x] 65.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-064 芯片锁定态与悬停提示`，记录正确原因的 red（已有回归记录基线）。
- [x] 65.2 实现「AUTO 主模型支持范围与不可用锁定」中该场景所需的最小行为，使 65.1 通过。
- [x] 65.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 66. 切回受支持模型后恢复可切换

- [x] 66.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-065 切回受支持模型后恢复可切换`，记录正确原因的 red（已有回归记录基线）。
- [x] 66.2 实现「AUTO 主模型支持范围与不可用锁定」中该场景所需的最小行为，使 66.1 通过。
- [x] 66.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 67. 支持范围判定只依据注册表

- [x] 67.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-066 支持范围判定只依据注册表`，记录正确原因的 red（已有回归记录基线）。
- [x] 67.2 实现「AUTO 主模型支持范围与不可用锁定」中该场景所需的最小行为，使 67.1 通过。
- [x] 67.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 68. 支持范围内映射不可得不阻断请求

- [x] 68.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-067 支持范围内映射不可得不阻断请求`，记录正确原因的 red（已有回归记录基线）。
- [x] 68.2 实现「AUTO 主模型支持范围与不可用锁定」中该场景所需的最小行为，使 68.1 通过。
- [x] 68.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 69. Magpie 自动子路由

- [x] 69.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-068 Magpie 自动子路由`，记录正确原因的 red（已有回归记录基线）。
- [x] 69.2 实现「AUTO 决策与执行」中该场景所需的最小行为，使 69.1 通过。
- [x] 69.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 70. 未登记 provider 的 GPT 主会话可以派子任务

- [x] 70.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-069 未登记 provider 的 GPT 主会话可以派子任务`，记录正确原因的 red（已有回归记录基线）。
- [x] 70.2 实现「AUTO 决策与执行」中该场景所需的最小行为，使 70.1 通过。
- [x] 70.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 71. AUTO 下返回推荐且保留显式维度

- [x] 71.1 编写或强化 `packages/auto-model-routing/test/subagent-tool.test.ts` 中 `AMR-070 AUTO 下返回推荐且保留显式维度`，记录正确原因的 red（已有回归记录基线）。
- [x] 71.2 实现「子任务路由预览工具」中该场景所需的最小行为，使 71.1 通过。
- [x] 71.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 72. MANUAL 与不可用路由

- [x] 72.1 编写或强化 `packages/auto-model-routing/test/subagent-tool.test.ts` 中 `AMR-071 MANUAL 与不可用路由`，记录正确原因的 red（已有回归记录基线）。
- [x] 72.2 实现「子任务路由预览工具」中该场景所需的最小行为，使 72.1 通过。
- [x] 72.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 73. 预览失败与取消的区分

- [x] 73.1 编写或强化 `packages/auto-model-routing/test/subagent-tool.test.ts` 中 `AMR-072 预览失败与取消的区分`，记录正确原因的 red（已有回归记录基线）。
- [x] 73.2 实现「子任务路由预览工具」中该场景所需的最小行为，使 73.1 通过。
- [x] 73.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 74. 新旧 Magpie 子实例保持精确身份并恢复

- [x] 74.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-073 新旧 Magpie 子实例保持精确身份并恢复`，记录正确原因的 red（已有回归记录基线）。
- [x] 74.2 实现「AUTO 的双 Magpie 精确 transport 兼容」中该场景所需的最小行为，使 74.1 通过。
- [x] 74.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 75. 未注册家族的 Magpie 模型需显式模型与可验证 effort

- [x] 75.1 编写或强化 `packages/auto-model-routing/test/policy-host.integration.test.ts` 中 `AMR-074 未注册家族的 Magpie 模型需显式模型与可验证 effort`，记录正确原因的 red（已有回归记录基线）。
- [x] 75.2 实现「AUTO 的双 Magpie 精确 transport 兼容」中该场景所需的最小行为，使 75.1 通过。
- [x] 75.3 重构并重跑相关回归；test-plan 对应行实际通过后标 green。

## 76. 全量验证与收尾

- [x] 76.1 运行 package test/typecheck/build、根 `npm test`、`npm run check:artifacts`，记录实际结果。
- [x] 76.2 严格校验 change，确认无未验证 green；生成 verify.md。
- [x] 76.3 同步 delta 到 current spec，并手动更新 Purpose 中 transport 前缀描述。
- [x] 76.4 汇报结果；部署、合入、归档需用户另行授权。
