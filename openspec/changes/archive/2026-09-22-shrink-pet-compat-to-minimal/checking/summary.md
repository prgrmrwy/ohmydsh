# 历史结论摘要：收缩 Pet compatibility

当时兼容范围由 7 个替换上游包收敛到 1 个 subagent 包；批 A/B 完成，批 C 的移除判定经复核被证伪，因此不执行批 C。

- 未启用的 isolated claim seam 删除；storage 改为自有注册 backend，保留原子提交/独占 writer 的 fail-closed 门禁。生产 SQLite 独占意味着备份和切换需要停机，不能绕过。
- 官方可指定 childId 不等于可创建不投递内容的 idle child；composeFrom 的父 mount bind 不等于子代独立 mount/冷恢复。durable toolFilter 虽有官方支持，但与 descriptor 版本耦合，不能仅按相似签名退 patch。
- 保留 silent settlement、idle、independent 冷恢复与精确 child Session 等语义；官方一次性 CLI 与长期 compatibility Host 入口继续分离，版本/依赖身份不明则拒绝。
- 最终 live 又发现 silent 策略在冷恢复漏传，已修复并在重启后复测父通知为零；两个独立父/child activation 分别通过，不冒充同父两个 locus 的测试。
- 中间 footprint 表是 32 hunks，live 修复后 tasks 记录 33 hunks；不得拿中间数当最终源码身份。历史 root 141 pass、Pet 2726 pass/43 skip。
- 回滚素材完整性验证通过，但完整回滚演练由操作者明确不执行；不能将文档/备份存在写成演练通过。

## 证据退役（2026-10-27）

按用户批准移除 11 份详细 API 调查、spike、provenance/footprint 与阶段实施记录，未复制原始内容到此摘要。

逐文件历史：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-22-shrink-pet-compat-to-minimal/checking/<原相对路径>`。重用前核对当前 DSH pin 与真实调用链，不把历史结论泛化到新版。
