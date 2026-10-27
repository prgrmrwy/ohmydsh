# 历史真实验收摘要：Pet Delivery 安全加固

2026-09-19 最后记录：A/B/C/D/F 通过，G 先失败、修复后新 locus 复验通过；E 在当时 DSH pin 未触发目标 mixed-source 判据，不能标成真机 PASS。

- 首轮投递失败根因是规范化丢失 childComposition，修复字段传递与诊断接线，并补跨层真实 delivery 路径回归，不能只分别 stub 两端。
- 正常唯一出口、reference-only 静默、澄清新 Delivery、backlog 串行及图片附件路径均获得真实证据。
- own 层 subagent 曾绕过继承 toolFilter；最小组合修复后禁止再派生，并补真实 scoped surface attestation。旧 child 不因源码修改自动换组合，冷恢复也必须核验后才能发布。
- 断联自动重连和重连后零重复处理通过；平台未重投事件，故“重投去重”只具测试覆盖，不声称真机触发。
- GUI 消息实际进入下一轮，未产生 foreign claim；E 的安全负向结果与 mixed-source 硬闸覆盖必须分开。

## 证据退役（2026-10-27）

按用户批准移除 1 份详细 live 清单与历史环境记录，保留上述失败、修复与未覆盖边界，不保留群/会话标识或消息原文。

历史原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-19-pet-locus-delivery-safety-hardening/checking/live-acceptance.md`。
