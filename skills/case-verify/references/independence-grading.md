# 独立性与 Verdict

来源分级：
- 高：同时至少有一个spec和一个independent来源（QA XMind或外部QA用例平台）。
- 低：只有spec来源；报告注明“oracle 与实现同源，绿不等于免人工”。
- degraded：无结构化oracle，仅能从diff推断；不具自动验收资格，不把推断结论当独立需求。

执行独立与oracle独立是两件事。独立性高时比较spec与independent集合，记录independent-only缺口，Reviewer优先补入。不可凭adapter名字把spec升级为independent，声明和来源内容必须可追溯。

Verdict纪律：
1. 当前有效观察有fail，报告FAIL。
2. unverified期望、manual/partial/blocked、未执行/未覆盖或天然盲区必须显式列出，不能靠derived通过抬高原需求结论。
3. 独立性低、lint不足或没有结构化来源时needs-human或ineligible/degraded。
4. 只有在确认的原需求范围、可判定性、独立来源和执行证据都足够、没有未解决失败/缺口时，才可说明auto-accept-eligible；这仍是“具备资格”，不是替用户签署验收。

工具成功、结构门禁PASS、查看器计算绿灯都不是验收结论。观察没有截图但有limits时不伪造图，报告披露证据限制。
