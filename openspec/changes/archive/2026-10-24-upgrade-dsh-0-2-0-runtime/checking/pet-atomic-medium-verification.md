# Pet实际built backend：跨表批次回滚与独立重读通过

## 来源与隔离

被测为devbox83c69cf候选实际lib/host/storage/backend.js；SHA256=df024297dbb4306faec08a2c47b1135af673709826850b08d01ec5157d80d702，与部署profile中的同文件cmp一致。使用Node24.12.0和真实node:sqlite，不mock数据库。

测试mkdtemp创建验收root下owner-only新目录，数据库全新，domain/unit名acceptance_atomic，仅left_rows/right_rows及global测试数据。完全未打开现有Pet state.sqlite，不启动Host或模型，不创建真实Task/Invocation/Locus。

规范依据为dsh-pet/spec.md93、107–117，实际backend.ts204–224在同一持锁写入连接BEGIN IMMEDIATE并在错误时ROLLBACK。

## 准确oracle与通过结果

1. 基线批次写left_rows.old、right_rows.old及generation=1。
2. 批次暂存left_rows.transient、删除right_rows.old、更新global=99，最后写未声明表。核验异常包含declared no table；loadAll完整deepEqual基线，无部分改动。
3. 批次暂存right_rows.transient、更新global=88，最后用null主键触发真实SQLite STRICT表NOT NULL约束。核验code=ERR_SQLITE_ERROR及NOT NULL constraint failed；loadAll完整deepEqual基线。
4. 随后成功批次删除left旧值、写两表committed值、global=2，完整结果deepEqual期望。
5. close后独立Node进程加载同一built backend重开，同一descriptor读回整个expected JSON；进程exit0。
6. 只读PRAGMA integrity_check=ok，总probe exit0。

初版用undefined value误称SQL constraint；准确错误核验揭示Node绑定阶段ERR_INVALID_ARG_TYPE。保留该失败，最终以null主键触发真正SQL约束，而非放宽错误断言。没有产品源码修复。

## 门禁边界

证明实际持久介质上的跨表put/delete/global全有或全无、失败后可继续提交以及独立重读。不是完整storage-domain发布/事件路径，不证明Locus多条业务记录的调度一致、断电或SIGKILL恢复，也不证明非空Task自动恢复。

本轮无后台Host残留，39521无监听；生产3080仍PID2004366。原repo clean；正式manifest pin、local DSH/VM及生产均未改。为5.6/5.7补充backend原子性部分证据，不勾选总项，整体升级NO-GO。
