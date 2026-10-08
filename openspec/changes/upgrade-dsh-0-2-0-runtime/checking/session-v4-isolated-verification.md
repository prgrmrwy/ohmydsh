# Session v4隔离持久化与旧版读取回滚

## 边界与身份

全程devbox、独立HOME/DSH_HOME/XDG。早期合成阶段未读取生产sessions；后续仅只读捕获3个现役样本做远端原样私有副本，未改生产sessions或运行中的生产Host。新侧使用已构建候选launcher中的@deepseek-ai/dsh-session-persistence-jsonl 0.2.0-rc.2；上游源码639ed015397290b3745d163aafe02ffee4aa3f84。旧側单独目录安装0.1.5-rc.2持久化/Session组件和Cordis4.0.2，不使用生产运行体。

## 执行结果

1. 上游session-persistence-jsonl与session-persistence套件：19文件，755 passed、1 skipped。覆盖migration/refusal/generation/restart/jsonl等。默认测试选择未包含.e2e.ts，不宣称两个进程lease和built-worker专用e2e已执行。
2. 额外plain Node探针直接import候选构建产物，使用7条事件的合成v3中断回合样本：
   - read-only在内存准备v4，不产生v4文件；原v3哈希不变。
   - write-open产生session.v4.jsonl，回合修复后8事件；原v3仍逐字节不变。
   - dispose后新Context打开，完整事件与迁移准备结果一致。
   - 添加未闭合JSON尾片段后，reader返回完整前缀，磁盘字节未被只读修复。
   - 损坏v4头部被拒绝，文件未改写，也未静默退回旧v3。
   - 旧版0.1.5-rc.2在独立Node进程拒绝v4。
   - 所有writer关闭，删除隔离v4并由备份恢复v3；哈希一致，旧版独立进程成功读取原7事件及消息正文。
3. 临时样本目录在finally清理；旧版依赖只保留在验收cache，未部署。探针exit0。

## 失败与修正透明记录

文档中的“0.1.5”是简称，不是已发布npm版本；查询精确0.1.5得到404后，从设计核对实际回滚pin为0.1.5-rc.2。首次用Cordis4.0.4装旧组件出现scope精确peer4.0.2冲突，改为匹配历史Cordis4.0.2并固定scope0.1.5-rc.2，正常install成功，没有force/legacy-peer-deps。

## 后续真实现役压缩副本验证（2026-10-07）

三个现役v3样本的原样私有压缩副本，仅在devbox fresh 0700临时目录中保存，文件0600；源只读、Persistence root仅隔离副本，不激活真实Agent，不传正文或真实身份/摘要到本机。旧版0.1.5-rc.2读取事件数为1009/1093/597；新版0.2.0-rc.2在独立进程read→write→再次独立进程reopen，各样本完整事件摘要与prepared结果一致，隔离v3副本压缩字节hash不变（未宣称生产原文件前后hash对照）。所有worker进程退出后核验测试路径/非symlink/备份hash，仅移除隔离v4压缩文件、恢复备份，旧reader再次读取全部事件成功。finally临时私有副本删除，exit0。

前置脱敏JSONL探针曾错误改变cwd身份、事件/操作enum、tool callId关联、catalog模式及title快照source，导致reader拒绝；不作为产品失败或PASS。停止扩大通用脱敏框架，采用不外传的原样私有副本对照，已证明这三个样本组件迁移路径可读写与恢复；本报告不宣称全历史、全身份关系或完整Host/manifest/Pet回滚。

## 不能据此声称的完成项

- 已做三个真实现役原样私有副本的组件数据演练（不是脱敏JSONL）；没有覆盖全部用户消息来源/插件历史全集，也不是完整Host/profile/Pet迁移回滚。
- 新侧重载使用新Context，旧侧使用新进程；不是完整新Host重启场景。
- 没有切回旧manifest/compat缓存、恢复完整Pet/profile/settings，也没有执行生产回滚。
- 因此升级任务3.10保持未勾选；此报告仅缩小其未验证范围。整体升级仍NO-GO。

原始日志与脚本留ignored .validation及devbox acceptance logs；没有会话密钥或生产内容写入报告。
