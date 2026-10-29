# 基础实施独立评审

范围：规划提交120f9140后的当前工作树，包括未跟踪的skills/case-verify与root测试。Reviewer：core-reviewer；只读，使用临时合成fixtures。历史236制品冲突单独待用户决定，不在本评审中重复计为代码缺陷。

## 初次结论：REVISE

1. Important：structured assert_dom expected_visible/selector但无文本期望，能够作为自动presence-only通过门禁。回归与修复已完成，等待focused复核。
2. Important：automation拼写错误/缺失绕过pending检查。需在模型边界验证必需enum和容器类型。
3. Important：supersede执行维度用Python dict equality，true与1（含嵌套）相等，可错误消除失败。需按canonical JSON比较去掉版本键后的env。
4. Moderate：plan=[]、meta=null、steps=[null]、观察行[]触发未处理AttributeError。计划根类型已修；其余须字段/行号定位校验。

## 已验证的正向证据

- 初次独立Python全套82通过，但未覆盖上述负向形式，不能作为完成证据。
- 独立注入os.write短写20字节，追加失败且原日志完整字节恢复。
- revision fence、全计划失效、记账字段排除、历史证据哈希、真实报告门禁与并发supersede测试未发现额外问题。

## 当前状态

四组代码缺陷已完成focused复核关闭（core-reviewer）：独立运行原synthetic repro确认结构presence-only被拒、缺失/拼错automation拒绝confirm、bool→number supersede拒绝且原fail保留、plan/meta/step/JSONL错误均友好拒绝并定位。Lead fresh `python3 -B -m unittest discover -s skills/case-verify/tests`：87 tests OK /27.169s，exit0。此结论只关闭这四组代码问题，不代表整个change完成；历史制品政策、文档完整性、持久fixture、全仓失败与私有/部署事项仍未闭环，未开始viewer。
