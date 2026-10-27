# 历史交付与验收摘要：DSH 0.2.0 升级

2026-10-24 用户确认运行体升级完成并授权归档；tasks 保留 27 项未勾选，不将收尾决定改写为完整验收通过。早期 NO-GO、阶段局部 PASS 和最终交付的范围必须分开。

- 适配新 Agent/Session/message/configForms/preset API，并保持生成区所有权、配置合并与失败恢复。跨文件进程中断恢复已测，不等于断电 fsync 保证。
- 最后 devbox root 319 pass/2 skip/0 fail，11 个 local package 测试及声明的 build/typecheck 通过；固定组合 sync×2 第二次无变化，官方 dump 与 Host 启动通过。
- cost-meter 1.8.4 与原 header 0.1.0 为无需第三方源码 patch 的正式组合；较新 cost fetch observer 的递归故障不靠删用户价表或修改第三方掩盖。自研 bridge 后发布 0.6.1，消费方已迁移并合入。
- Memory UI 保存/回读/sync/刷新有限场景通过，早期刷新失败保留为历史；session-links 的配置编辑实验撤回，不作为当前产品能力。
- Session v4 副本读写/重启与旧 reader 恢复、Pet built backend 原子回滚/独占/故障边界有部分证据；完整真实 Pet 冷恢复、投递/媒体、旧 Host 续写、私有 overlay 矩阵等未由组件测试替代。
- 标题徽标与 provider 按行更新、Pet 子代导航获得有限真实 UI 证据；按切换归因的 guard 预热、有内容子代渲染等仍缺证。实际 schedule 创建/到点投递、有限模型/tool 调用各有观察，不代表全模型矩阵。
- d1c4c15 正式交付已受控合入并在 devbox build×2/restart；未认证 401 仅证明边界，不是业务 API 通过。额外隔离 home 检查源于范围误解，不计用户要求的新机验收；临时服务已停止。其他设备交用户决定。

## 证据退役（2026-10-27）

按用户批准移除 32 份阶段实现、设备环境、详细设置/存储/回滚/部署报告，保留上述结论及未完成边界；未将原始会话、组织值、备份或环境输出搬入此摘要。

逐文件原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-24-upgrade-dsh-0-2-0-runtime/checking/<原相对路径>`。这是历史已入库文本的追溯锚点，不承诺外部日志、临时实例或原始私有副本仍存在。
