## 0. 准备

- [x] 0.1 核对 review 有效且无 spec 漂移；准备空壳测试入口与合成临时 fixture，先确认测试可收集，禁止把导入失败当行为 red。

## 1. 新格式目录被接受

- [x] 1.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_001`，确认该场景因目标行为缺失而失败。
- [x] 1.2 按 `specs/case-verify-evidence/spec.md → checking 目录布局与格式识别` 最小实现该行为，使 1.1 通过，并更新 test-plan 对应行。
- [x] 1.3 重构，运行相关完整测试集并保持绿色。

## 2. 旧格式目录被拒绝

- [x] 2.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_002`，确认该场景因目标行为缺失而失败。
- [x] 2.2 按 `specs/case-verify-evidence/spec.md → checking 目录布局与格式识别` 最小实现该行为，使 2.1 通过，并更新 test-plan 对应行。
- [x] 2.3 重构，运行相关完整测试集并保持绿色。

## 3. 首次片段校验不依赖冻结

- [x] 3.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_003`，确认该场景因目标行为缺失而失败。
- [x] 3.2 按 `specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结` 最小实现该行为，使 3.1 通过，并更新 test-plan 对应行。
- [x] 3.3 重构，运行相关完整测试集并保持绿色。

## 4. 冻结后记录哈希

- [ ] 4.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_004`，确认该场景因目标行为缺失而失败。
- [x] 4.2 按 `specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结` 最小实现该行为，使 4.1 通过，并更新 test-plan 对应行。
- [x] 4.3 重构，运行相关完整测试集并保持绿色。

## 5. 冻结后被修改

- [ ] 5.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_005`，确认该场景因目标行为缺失而失败。
- [x] 5.2 按 `specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结` 最小实现该行为，使 5.1 通过，并更新 test-plan 对应行。
- [x] 5.3 重构，运行相关完整测试集并保持绿色。

## 6. 重新冻结使当前计划失效

- [ ] 6.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_006`，确认该场景因目标行为缺失而失败。
- [x] 6.2 按 `specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结` 最小实现该行为，使 6.1 通过，并更新 test-plan 对应行。
- [x] 6.3 重构，运行相关完整测试集并保持绿色。

## 7. 非法 oracle

- [x] 7.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_007`，确认该场景因目标行为缺失而失败。
- [x] 7.2 按 `specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结` 最小实现该行为，使 7.1 通过，并更新 test-plan 对应行。
- [x] 7.3 重构，运行相关完整测试集并保持绿色。

## 8. 合法追溯

- [ ] 8.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_008`，确认该场景因目标行为缺失而失败。
- [x] 8.2 按 `specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle` 最小实现该行为，使 8.1 通过，并更新 test-plan 对应行。
- [x] 8.3 重构，运行相关完整测试集并保持绿色。

## 9. 引用不存在的 oracle

- [x] 9.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_009`，确认该场景因目标行为缺失而失败。
- [x] 9.2 按 `specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle` 最小实现该行为，使 9.1 通过，并更新 test-plan 对应行。
- [x] 9.3 重构，运行相关完整测试集并保持绿色。

## 10. oracle 来源却没有挂载

- [x] 10.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_010`，确认该场景因目标行为缺失而失败。
- [x] 10.2 按 `specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle` 最小实现该行为，使 10.1 通过，并更新 test-plan 对应行。
- [x] 10.3 重构，运行相关完整测试集并保持绿色。

## 11. 计划中残留执行结果

- [x] 11.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_011`，确认该场景因目标行为缺失而失败。
- [x] 11.2 按 `specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle` 最小实现该行为，使 11.1 通过，并更新 test-plan 对应行。
- [x] 11.3 重构，运行相关完整测试集并保持绿色。

## 12. 确认齐备后可以记录观察

- [x] 12.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_012`，确认该场景因目标行为缺失而失败。
- [x] 12.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 12.1 通过，并更新 test-plan 对应行。
- [x] 12.3 重构，运行相关完整测试集并保持绿色。

## 13. 未确认计划时不能记录观察

- [x] 13.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_013`，确认该场景因目标行为缺失而失败。
- [x] 13.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 13.1 通过，并更新 test-plan 对应行。
- [x] 13.3 重构，运行相关完整测试集并保持绿色。

## 14. 策略不可用时不能确认

- [x] 14.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_014`，确认该场景因目标行为缺失而失败。
- [x] 14.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 14.1 通过，并更新 test-plan 对应行。
- [x] 14.3 重构，运行相关完整测试集并保持绿色。

## 15. 仅修改 plan 的执行字段也会失效

- [x] 15.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_015`，确认该场景因目标行为缺失而失败。
- [x] 15.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 15.1 通过，并更新 test-plan 对应行。
- [x] 15.3 重构，运行相关完整测试集并保持绿色。

## 16. 外部报告 URL 更新不影响确认

- [x] 16.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_016`，确认该场景因目标行为缺失而失败。
- [x] 16.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 16.1 通过，并更新 test-plan 对应行。
- [x] 16.3 重构，运行相关完整测试集并保持绿色。

## 17. 同内容重新确认也必须重跑

- [x] 17.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_017`，确认该场景因目标行为缺失而失败。
- [x] 17.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 17.1 通过，并更新 test-plan 对应行。
- [x] 17.3 重构，运行相关完整测试集并保持绿色。

## 18. 重挂 oracle 后旧通过不可继承

- [x] 18.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_018`，确认该场景因目标行为缺失而失败。
- [x] 18.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 18.1 通过，并更新 test-plan 对应行。
- [x] 18.3 重构，运行相关完整测试集并保持绿色。

## 19. derived 断言变化后必须重跑

- [x] 19.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_019`，确认该场景因目标行为缺失而失败。
- [x] 19.2 按 `specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘` 最小实现该行为，使 19.1 通过，并更新 test-plan 对应行。
- [x] 19.3 重构，运行相关完整测试集并保持绿色。

## 20. 追加保留已有内容

- [x] 20.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_020`，确认该场景因目标行为缺失而失败。
- [x] 20.2 按 `specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入` 最小实现该行为，使 20.1 通过，并更新 test-plan 对应行。
- [x] 20.3 重构，运行相关完整测试集并保持绿色。

## 21. 并发追加

- [x] 21.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_021`，确认该场景因目标行为缺失而失败。
- [x] 21.2 按 `specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入` 最小实现该行为，使 21.1 通过，并更新 test-plan 对应行。
- [x] 21.3 重构，运行相关完整测试集并保持绿色。

## 22. 迟到旧 worker 结果被拒绝

- [x] 22.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_022`，确认该场景因目标行为缺失而失败。
- [x] 22.2 按 `specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入` 最小实现该行为，使 22.1 通过，并更新 test-plan 对应行。
- [x] 22.3 重构，运行相关完整测试集并保持绿色。

## 23. 新 revision 真正重跑成功

- [x] 23.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_023`，确认该场景因目标行为缺失而失败。
- [x] 23.2 按 `specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入` 最小实现该行为，使 23.1 通过，并更新 test-plan 对应行。
- [x] 23.3 重构，运行相关完整测试集并保持绿色。

## 24. 非法记录不写入

- [x] 24.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_024`，确认该场景因目标行为缺失而失败。
- [x] 24.2 按 `specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入` 最小实现该行为，使 24.1 通过，并更新 test-plan 对应行。
- [x] 24.3 重构，运行相关完整测试集并保持绿色。

## 25. 带截图的通过

- [x] 25.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_025`，确认该场景因目标行为缺失而失败。
- [x] 25.2 按 `specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录` 最小实现该行为，使 25.1 通过，并更新 test-plan 对应行。
- [x] 25.3 重构，运行相关完整测试集并保持绿色。

## 26. 工具返回成功但没有证据

- [x] 26.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_026`，确认该场景因目标行为缺失而失败。
- [x] 26.2 按 `specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录` 最小实现该行为，使 26.1 通过，并更新 test-plan 对应行。
- [x] 26.3 重构，运行相关完整测试集并保持绿色。

## 27. 已引用的证据被覆盖

- [x] 27.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_027`，确认该场景因目标行为缺失而失败。
- [x] 27.2 按 `specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录` 最小实现该行为，使 27.1 通过，并更新 test-plan 对应行。
- [x] 27.3 重构，运行相关完整测试集并保持绿色。

## 28. 证据路径越界

- [x] 28.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_028`，确认该场景因目标行为缺失而失败。
- [x] 28.2 按 `specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录` 最小实现该行为，使 28.1 通过，并更新 test-plan 对应行。
- [x] 28.3 重构，运行相关完整测试集并保持绿色。

## 29. 事后纠偏

- [x] 29.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_029`，确认该场景因目标行为缺失而失败。
- [x] 29.2 按 `specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成` 最小实现该行为，使 29.1 通过，并更新 test-plan 对应行。
- [x] 29.3 重构，运行相关完整测试集并保持绿色。

## 30. 非法纠偏

- [x] 30.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_030`，确认该场景因目标行为缺失而失败。
- [x] 30.2 按 `specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成` 最小实现该行为，使 30.1 通过，并更新 test-plan 对应行。
- [x] 30.3 重构，运行相关完整测试集并保持绿色。

## 31. 竞争纠偏只有一个成功

- [x] 31.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_031`，确认该场景因目标行为缺失而失败。
- [x] 31.2 按 `specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成` 最小实现该行为，使 31.1 通过，并更新 test-plan 对应行。
- [x] 31.3 重构，运行相关完整测试集并保持绿色。

## 32. 非法 revision 被拒绝

- [x] 32.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_032`，确认该场景因目标行为缺失而失败。
- [x] 32.2 按 `specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成` 最小实现该行为，使 32.1 通过，并更新 test-plan 对应行。
- [x] 32.3 重构，运行相关完整测试集并保持绿色。

## 33. 多环境下的保守计算

- [x] 33.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_033`，确认该场景因目标行为缺失而失败。
- [x] 33.2 按 `specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算` 最小实现该行为，使 33.1 通过，并更新 test-plan 对应行。
- [x] 33.3 重构，运行相关完整测试集并保持绿色。

## 34. 局部复测不能抹掉另一环境的失败

- [x] 34.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_034`，确认该场景因目标行为缺失而失败。
- [x] 34.2 按 `specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算` 最小实现该行为，使 34.1 通过，并更新 test-plan 对应行。
- [x] 34.3 重构，运行相关完整测试集并保持绿色。

## 35. 复测解除失败

- [x] 35.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_035`，确认该场景因目标行为缺失而失败。
- [x] 35.2 按 `specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算` 最小实现该行为，使 35.1 通过，并更新 test-plan 对应行。
- [x] 35.3 重构，运行相关完整测试集并保持绿色。

## 36. 续跑范围

- [x] 36.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_036`，确认该场景因目标行为缺失而失败。
- [x] 36.2 按 `specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算` 最小实现该行为，使 36.1 通过，并更新 test-plan 对应行。
- [x] 36.3 重构，运行相关完整测试集并保持绿色。

## 37. 手改统计被发现

- [x] 37.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_037`，确认该场景因目标行为缺失而失败。
- [x] 37.2 按 `specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算` 最小实现该行为，使 37.1 通过，并更新 test-plan 对应行。
- [x] 37.3 重构，运行相关完整测试集并保持绿色。

## 38. 合法目录通过

- [ ] 38.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_038`，确认该场景因目标行为缺失而失败。
- [x] 38.2 按 `specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口` 最小实现该行为，使 38.1 通过，并更新 test-plan 对应行。
- [x] 38.3 重构，运行相关完整测试集并保持绿色。

## 39. 列出覆盖缺口

- [x] 39.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_039`，确认该场景因目标行为缺失而失败。
- [x] 39.2 按 `specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口` 最小实现该行为，使 39.1 通过，并更新 test-plan 对应行。
- [x] 39.3 重构，运行相关完整测试集并保持绿色。

## 40. 未验证期望计入通过

- [x] 40.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_040`，确认该场景因目标行为缺失而失败。
- [x] 40.2 按 `specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口` 最小实现该行为，使 40.1 通过，并更新 test-plan 对应行。
- [x] 40.3 重构，运行相关完整测试集并保持绿色。

## 41. 报告缺少新章节

- [ ] 41.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_041`，确认该场景因目标行为缺失而失败。
- [x] 41.2 按 `specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口` 最小实现该行为，使 41.1 通过，并更新 test-plan 对应行。
- [x] 41.3 重构，运行相关完整测试集并保持绿色。

## 42. mock 未确认被拦截

- [x] 42.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_042`，确认该场景因目标行为缺失而失败。
- [x] 42.2 按 `specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变` 最小实现该行为，使 42.1 通过，并更新 test-plan 对应行。
- [x] 42.3 重构，运行相关完整测试集并保持绿色。

## 43. presence-only 点击被拦截

- [x] 43.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_043`，确认该场景因目标行为缺失而失败。
- [x] 43.2 按 `specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变` 最小实现该行为，使 43.1 通过，并更新 test-plan 对应行。
- [x] 43.3 重构，运行相关完整测试集并保持绿色。

## 44. 合法计划通过两个门禁

- [ ] 44.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_044`，确认该场景因目标行为缺失而失败。
- [x] 44.2 按 `specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变` 最小实现该行为，使 44.1 通过，并更新 test-plan 对应行。
- [x] 44.3 重构，运行相关完整测试集并保持绿色。

## 45. checkpoint mock 缺口不能被 trail 决定掩盖

- [x] 45.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_045`，确认该场景因目标行为缺失而失败。
- [x] 45.2 按 `specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变` 最小实现该行为，使 45.1 通过，并更新 test-plan 对应行。
- [x] 45.3 重构，运行相关完整测试集并保持绿色。

## 46. 缺失文本命中与未命中

- [x] 46.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_046`，确认该场景因目标行为缺失而失败。
- [x] 46.2 按 `specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变` 最小实现该行为，使 46.1 通过，并更新 test-plan 对应行。
- [x] 46.3 重构，运行相关完整测试集并保持绿色。

## 47. 受限状态如实通过结构门禁

- [ ] 47.1 在 `skills/case-verify/tests/test_model_gates.py` 编写 `test_cv_047`，确认该场景因目标行为缺失而失败。
- [x] 47.2 按 `specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变` 最小实现该行为，使 47.1 通过，并更新 test-plan 对应行。
- [x] 47.3 重构，运行相关完整测试集并保持绿色。

## 48. 启用后部署且幂等

- [x] 48.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_048`，确认该场景因目标行为缺失而失败。
- [x] 48.2 按 `specs/case-verify-skill/spec.md → skill 由 manifest 登记并只经 sync 部署` 最小实现该行为，使 48.1 通过，并更新 test-plan 对应行。
- [x] 48.3 重构，运行相关完整测试集并保持绿色。

## 49. 禁用后移除

- [x] 49.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_049`，确认该场景因目标行为缺失而失败。
- [x] 49.2 按 `specs/case-verify-skill/spec.md → skill 由 manifest 登记并只经 sync 部署` 最小实现该行为，使 49.1 通过，并更新 test-plan 对应行。
- [x] 49.3 重构，运行相关完整测试集并保持绿色。

## 50. 主机名白名单通过

- [x] 50.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_050`，确认该场景因目标行为缺失而失败。
- [x] 50.2 按 `specs/case-verify-skill/spec.md → 公开 skill 不含组织专属值` 最小实现该行为，使 50.1 通过，并更新 test-plan 对应行。
- [x] 50.3 重构，运行相关完整测试集并保持绿色。

## 51. 混入内部域名被拦截

- [x] 51.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_051`，确认该场景因目标行为缺失而失败。
- [x] 51.2 按 `specs/case-verify-skill/spec.md → 公开 skill 不含组织专属值` 最小实现该行为，使 51.1 通过，并更新 test-plan 对应行。
- [x] 51.3 重构，运行相关完整测试集并保持绿色。

## 52. 匹配唯一 adapter

- [x] 52.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_052`，确认该场景因目标行为缺失而失败。
- [x] 52.2 按 `specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现` 最小实现该行为，使 52.1 通过，并更新 test-plan 对应行。
- [x] 52.3 重构，运行相关完整测试集并保持绿色。

## 53. 无匹配或多重匹配

- [x] 53.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_053`，确认该场景因目标行为缺失而失败。
- [x] 53.2 按 `specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现` 最小实现该行为，使 53.1 通过，并更新 test-plan 对应行。
- [x] 53.3 重构，运行相关完整测试集并保持绿色。

## 54. 名称不安全或重名

- [x] 54.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_054`，确认该场景因目标行为缺失而失败。
- [x] 54.2 按 `specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现` 最小实现该行为，使 54.1 通过，并更新 test-plan 对应行。
- [x] 54.3 重构，运行相关完整测试集并保持绿色。

## 55. 描述非法的候选

- [x] 55.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_055`，确认该场景因目标行为缺失而失败。
- [x] 55.2 按 `specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现` 最小实现该行为，使 55.1 通过，并更新 test-plan 对应行。
- [x] 55.3 重构，运行相关完整测试集并保持绿色。

## 56. 合法片段进入合并

- [x] 56.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_056`，确认该场景因目标行为缺失而失败。
- [x] 56.2 按 `specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1` 最小实现该行为，使 56.1 通过，并更新 test-plan 对应行。
- [x] 56.3 重构，运行相关完整测试集并保持绿色。

## 57. 声明为 spec 的来源不被升级

- [x] 57.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_057`，确认该场景因目标行为缺失而失败。
- [x] 57.2 按 `specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1` 最小实现该行为，使 57.1 通过，并更新 test-plan 对应行。
- [x] 57.3 重构，运行相关完整测试集并保持绿色。

## 58. 多次拉取互不覆盖

- [x] 58.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_058`，确认该场景因目标行为缺失而失败。
- [x] 58.2 按 `specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1` 最小实现该行为，使 58.1 通过，并更新 test-plan 对应行。
- [x] 58.3 重构，运行相关完整测试集并保持绿色。

## 59. 片段非法时停止

- [x] 59.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_059`，确认该场景因目标行为缺失而失败。
- [x] 59.2 按 `specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1` 最小实现该行为，使 59.1 通过，并更新 test-plan 对应行。
- [x] 59.3 重构，运行相关完整测试集并保持绿色。

## 60. adapter 执行失败

- [x] 60.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_060`，确认该场景因目标行为缺失而失败。
- [x] 60.2 按 `specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1` 最小实现该行为，使 60.1 通过，并更新 test-plan 对应行。
- [x] 60.3 重构，运行相关完整测试集并保持绿色。

## 61. 没有可用 adapter

- [x] 61.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_061`，确认该场景因目标行为缺失而失败。
- [x] 61.2 按 `specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1` 最小实现该行为，使 61.1 通过，并更新 test-plan 对应行。
- [x] 61.3 重构，运行相关完整测试集并保持绿色。

## 62. 首次推送记录地址

- [x] 62.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_062`，确认该场景因目标行为缺失而失败。
- [x] 62.2 按 `specs/case-verify-skill/spec.md → report-sink adapter 只在报告门禁通过后推送` 最小实现该行为，使 62.1 通过，并更新 test-plan 对应行。
- [x] 62.3 重构，运行相关完整测试集并保持绿色。

## 63. 报告无效时不调用推送

- [x] 63.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_063`，确认该场景因目标行为缺失而失败。
- [x] 63.2 按 `specs/case-verify-skill/spec.md → report-sink adapter 只在报告门禁通过后推送` 最小实现该行为，使 63.1 通过，并更新 test-plan 对应行。
- [x] 63.3 重构，运行相关完整测试集并保持绿色。

## 64. 推送失败不影响本地结论

- [x] 64.1 在 `skills/case-verify/tests/test_adapters.py` 编写 `test_cv_064`，确认该场景因目标行为缺失而失败。
- [x] 64.2 按 `specs/case-verify-skill/spec.md → report-sink adapter 只在报告门禁通过后推送` 最小实现该行为，使 64.1 通过，并更新 test-plan 对应行。
- [x] 64.3 重构，运行相关完整测试集并保持绿色。

## 65. 仓库测试运行 skill 测试

- [ ] 65.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_065`，确认该场景因目标行为缺失而失败。
- [x] 65.2 按 `specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试` 最小实现该行为，使 65.1 通过，并更新 test-plan 对应行。
- [x] 65.3 重构，运行相关完整测试集并保持绿色。

## 66. 缺少合适的 Python

- [x] 66.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_066`，确认该场景因目标行为缺失而失败。
- [x] 66.2 按 `specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试` 最小实现该行为，使 66.1 通过，并更新 test-plan 对应行。
- [x] 66.3 重构，运行相关完整测试集并保持绿色。

## 67. Python 用例失败

- [x] 67.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_067`，确认该场景因目标行为缺失而失败。
- [x] 67.2 按 `specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试` 最小实现该行为，使 67.1 通过，并更新 test-plan 对应行。
- [x] 67.3 重构，运行相关完整测试集并保持绿色。

## 68. 不引入第三方模块

- [x] 68.1 在 `tests/case-verify.test.mjs` 编写 `test_cv_068`，确认该场景因目标行为缺失而失败。
- [x] 68.2 按 `specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试` 最小实现该行为，使 68.1 通过，并更新 test-plan 对应行。
- [x] 68.3 重构，运行相关完整测试集并保持绿色。

## 69. 拦截真实数据及归档副本

- [x] 69.1 在 `tests/tracked-artifacts.test.mjs` 编写 `test_cv_069`，确认该场景因目标行为缺失而失败。
- [x] 69.2 按 `specs/case-verify-skill/spec.md → 真实验收数据默认不入库` 最小实现该行为，使 69.1 通过，并更新 test-plan 对应行。
- [x] 69.3 重构，运行相关完整测试集并保持绿色。

## 70. fixture 与脱敏报告不触发新增规则

- [x] 70.1 在 `tests/tracked-artifacts.test.mjs` 编写 `test_cv_070`，确认该场景因目标行为缺失而失败。
- [x] 70.2 按 `specs/case-verify-skill/spec.md → 真实验收数据默认不入库` 最小实现该行为，使 70.1 通过，并更新 test-plan 对应行。
- [x] 70.3 重构，运行相关完整测试集并保持绿色。

## 70A. 用户批准的历史 checking 清理

- [x] 70A.1 读取236个现存违规文件并区分原始数据、历史结论和运行中的源码引用；在historical-cleanup.md记录授权、范围与不改Git历史的边界。
- [x] 70A.2 分archive/active写域清理；仅保留必要脱敏摘要，迁出仍被测试引用的源码helper，精确验证路径后删除清单文件。
- [x] 70A.3 修复现存引用，详细原证据引用显式标为历史Git快照；运行制品检查、helper回归与独立差异复核。

## 71. 流程文档、迁移与收尾

- [x] 71.1 按批准设计迁入并改名 skill，脱敏 references，完整示例统一 JSON，说明 plan_rev/expected-plan-rev、证据分层、显式 supersede；保留 oracle/mock/计划/策略确认点与六阶段纪律。
- [x] 71.2 登记 dsh.yaml brief/note（来源、可信 adapter 执行面、Python 运行边界、升级复核、移除及回退），更新 skills README 双语索引。
- [x] 71.3 对 Coverage Notes 额外回归按先红后绿补齐；最小 fixture 为 2 oracle、3 checkpoint（含 derived）、5 观察和运行时生成的假截图，不带真实数据。
- [x] 71.4 运行 Python/Node 测试、npm test、npm run check:artifacts、strict 校验；记录真实命令和计数。
- [x] 71.5 私有仓单独实现 oracle-source/report-sink adapter 和关键词扫描，配置 CASE_VERIFY_ADAPTERS；实际内部链接阶段 1 验证需用户参与，不擅自跨仓写入。
- [x] 71.6 用户批准合入后，在主 checkout 部署两次确认幂等；用户决定重启。只在 lstat/readlink 证明旧软链及新入口可用时 unlink，否则保留并报告。
- [x] 71.7 实施后生成 verify.md，核对全场景绿色、review 未过期、无真实数据入库；规划阶段不得写 PASS。
