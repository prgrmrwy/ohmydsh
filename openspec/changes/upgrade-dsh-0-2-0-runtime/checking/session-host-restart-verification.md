# 隔离完整Host重启：11个测试会话投影一致

被测对象：devbox ohmydsh83c69cf的隔离0.2.0-rc.2 launcher，既有fresh-fixed HOME/DSH_HOME/XDG；header/bridge修复候选与此前联调相同。不读取生产会话、不请求模型、不发外部消息。

## 操作与证据

1. 启动39521候选PID2390162，官方启动token换cookie。
2. 官方`session/list`读取列表，仅取cwd在验收root下的11个已有测试Session。
3. `session/projections`官方冷态非激活接口对每个Session返回非null基线；确认字段含asOfSeq、values。对完整JSON计算SHA256，私有ignored日志保存id/hash，不交付会话内容。
4. 核验cmdline与DSH_HOME后SIGTERM，Host正常exit0。
5. 用完全相同启动脚本与持久数据启动新进程PID2392823，重新交换认证token。
6. 再读列表及11个投影，与重启前id排序、数量和全部hash逐项deepEqual，PASS。
7. 核身份停止新候选，exit0。没有残留临时服务。

初次探针误用`SessionSummary.id`导致本地排序TypeError；核对官方types.ts后改为`sessionId`。这不是产品回归，也不是放宽比较。

## 严格边界

这是完整Host进程替换前后官方投影可读且一致的证明；不同于前轮new Context的组件级检查。但11个样本是本任务创建的测试会话，投影一致不等于全历史日志逐事件一致，更不等于生产v3→v4脱敏迁移、完整旧Host降级、Pet SQLite回滚。

与session-v4-isolated-verification.md共同补充任务3.10；该任务仍未勾选，整体升级保持NO-GO。
