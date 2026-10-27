# 历史结论摘要：Federated DSH Control Plane

本路线因架构选择转向独立 Cockpit 而归档，从未启用到真实用户 Host；归档说明和 ADR-0003 是最终范围依据，不把中间报告的任务计数当最终验收。

- M0 可行性通过：固定 rc.2 源码/patch 构建、Workspace NodeSection 隔离、完整路由身份清单、trust fence 内 middleware、注册失败逆序回滚、系统 OpenSSH 及三节点 ID 碰撞测试均取得证据。
- Host/client 入口接线、baseline hydration 与 per-client fallback 已补齐；三节点真实隔离实例覆盖远端生命周期和断线重连。
- 跨进程 CAS 复检不足以排除 lost update。实测后改为提交锁覆盖复检、rename 与 fsync；不能复用早期“复检已关闭竞争窗口”的作废结论。
- 最后仓库侧报告记录 root 99 项、package 135 项通过；真实付费 prompt/tool/approval、多客户端付费并发、真实启用与最终生产 GUI 未完成。better-sidebar 多节点布局未证明。
- 浏览器远端实时增量流没有接入；rc.2 单消费者接缝约束下用户接受 baseline 快照。部分 inventory 计数/归档投影是占位，不能声称完整实时联邦。
- 本 change 未提升为 current specs。历史 upstream 来源为 DeepSeek Harness、MIT；这里没有重新分发其源码/补丁。

## 证据退役（2026-10-27）

按用户批准移除 38 份细节报告、协议/UI 合成数据、源 manifest、两份实验 patch 与附属 NOTICE。未发现现行代码消费者，不把失去构建上下文的历史资产迁移到生产源码目录，也不把原始数据改名伪装为摘要。

逐文件原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-08-27-federated-dsh-control-plane/checking/<原相对路径>`。此历史锚点保留原有归属及许可说明；不保证已退出版本树的原始截图、私有日志或临时实例仍存在。
