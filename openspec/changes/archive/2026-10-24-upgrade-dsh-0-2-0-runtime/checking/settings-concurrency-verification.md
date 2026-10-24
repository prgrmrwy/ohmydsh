# 设置写入CAS与last-good隔离实测

对象：devbox隔离候选0.2.0-rc.2（ohmydsh83c69cf + 已验证header/bridge修复），39521；没有生产配置、私有overlay或外部消息操作。

通过官方启动token交换与settings/describe、settings/update接口完成：

|步骤|结果|
|---|---|
|读取dsh-memex原scopes及revision|成功，原值仅在内存保留|
|用当前revision写acceptance-cas测试scope|成功，立即describe回读完全相同，revision变化|
|用旧revision写stale-overwrite|拒绝，错误code=settings/conflict|
|冲突后回读|新scope未被覆盖|
|用当前revision写INVALID_NAME非法scope|拒绝，last-good scope未变|
|finally以最新revision恢复测试前scopes|成功，回读deepEqual原值|

探针exit0。核对候选PID2395097的cmdline与DSH_HOME后停止，Host正常exit0。报告不包含cookie、启动token或scope私有内容。

这证明实际Host API并发保护和失败原子性；不是设置页UI点击保存验证，不覆盖session-links配置或org键合并。3.8/4.5/6b.3仍保持未完成，不据此宣布整个升级可上线。
