# 当前主干迁移全范围自审（未提交批次）

范围：base b6e5c474 到当前托管工作树，包含新增未跟踪实现文件，不只查看最后一次修复。Native执行者以真实diff/source/test日志完成本轮审查；独立子代理协助源码查漏与两组模块测试，不能冒充已提交Git range或SSF receipt。

## 实际发现与修复

- R1 Important：patch writer没有ConfigEditor同款package.json锁，可能丢成功保存；RED实际出现sync忽略锁。持锁覆盖snapshot→state，patch/backup原子0600；39项ownership首轮GREEN，之后纳入最终根321项。
- R2 Important：退役mergeConfig片段残留组织键。逐key reversible ledger恢复旧值/清自身introduced键，用户后改保留报警，共同owner不提前退休。legacy import重叠值恢复有实际fixture测试。
- R3 Important：!!js对象resolver在重写时污染表达式。保留string tagged scalar且ledger/restoration保留marker；表达式只读不执行。
- 进一步审查：失败片段不允许部分发布；账本无效拒绝；原子新inode的mode必须0600；patch/state跨文件中断必须有journal而不是宣称atomic pair。全部修复及测试已纳入最终devbox319pass2skip。

## 能力保留

实际diff确认Pet shell-tier mutation、safe-v2/outbound guard与attestation主干实现未回退。launcher仍有undici7.30.0 override、build.mjs上游退出恢复、atomic pointer rollback，改动只更新目标版本/provenance。session-links仅dual-shape工具错误适配，没有新增Config UI。memex ConfigForm.mutate false保draft+错误，loader last-good守门存在且有真实Loader测试。

## 复核结果与边界

- 最终修复五文件SHA256本机与devbox相同；devboxroot321 total/319pass/2skip/0fail，artifacts/diff PASS；本机ownership+transaction25/25与OpenSpec strict PASS。
- clean npm ci与全部workspace build/11包tests、exact launcher、官方fresh profile sync2/dump207均实际通过；最终修复只涉及sync/helper/tests，不把此前package结果说成修复后重跑。
- 正式header0.1.0组合仍重现fetch递归；只有验收目录官方CLI装reviewed a5011e0后authenticated shell200+boot可用。正式pin未改，生产NO-GO。
- 无剩余已识别的本轮sync修复阻断。仍有真正的升级验收缺口：设置UI save/reread/sync/reopen、完整loader/browser、真实Cockpitbridge当前pin、Pet max-active/live/cold/preset/精确Session、Session真实副本/Host回滚、私有overlay与外部入口。
- journal保证可判定的进程中断恢复；无fsync不声称断电持久性。crash后ConfigEditor再改会导致hash不匹配，保留两者fail closed需人工解决；未知旧ledger不回溯猜删。

未合入、未提交、未推送/发布/生产build/restart；无全升级完成或GO宣告。
