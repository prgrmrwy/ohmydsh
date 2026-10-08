# UI保存接sync×2：配置保留通过，完整刷新链未通过

## 实测范围

devbox隔离候选，Memory UI普通编辑acceptance-scope.home并Save changes；真实settings/mutate成功，Host describe回读一致。随后在相同隔离HOME/DSH_HOME/XDG上运行真实scripts/sync.mjs两次和官方--dump-config。远端网络使用set_sh_devbox_proxy，没有修改正式manifest pin。

- UI保存与立即回读：PASS。
- sync×2后官方dump中scope.home仍为验收root/ui-memory-fixture：PASS。
- 第二次sync明确报告no changes：PASS。
- sync后运行中Host describe仍返回同一测试路径：PASS。
- 浏览器刷新等待Settings按钮90秒超时：FAIL，不能把本轮叫做完整链路通过。
- finally恢复原scopes/workspaces，并由独立探针再次deepEqual核对：PASS。

## 候选来源发生变化

第一次sync日志第16行明确记录：dsh-cockpit-bridge从临时file:...7102a12.tgz变回manifest正式0.5.1 release URL，re-adding。第二次无变化只证明与正式manifest一致，不证明与带未发布修复的候选一致。

因此sync前后不是同一个完整修复候选；这是重要验收provenance限制。缺少当次刷新页面异常栈，不能单凭此日志断言刷新失败唯一原因，但不能继续将其当作修复版组合验收。

DSH_LOCAL_MANIFEST指向的no-overlay/dsh.yaml是有意不存在的路径，用于隔离私有overlay，并非候选修复pin文件。读取该文件的scp返回不存在已核实；overlay当前只允许追加，不能直接覆盖现有插件id。

## 恢复与后续要求

停止候选后，通过官方plugin add恢复既有7102a12 tarball；SHA256校验ee79a6fdbea6a19f8009d7fcafc1575fb91b5bee9ae0ef2db7d6aed99a5bfc78通过，安装后的bridge client.js与修复源构建cmp一致，header构建cmp也一致。没有手改生成文件或正式manifest。

恢复后启动新候选PID2431841：独立配置恢复检查通过；无插桩浏览器普通重开Memory、展开acceptance-scope与路径输入可见检查通过，无设置写入。随后核身份SIGTERM正常exit0。先前PID2427859也正常exit0；生产3080始终PID2004366。

以后任何跨sync验收必须先冻结可重建的隔离候选manifest/精确依赖来源，或等待正式发布pin；不能反复临时安装后假定sync会保留。不得为达成此条件擅自改正式pin。

本轮只新增UI产生的设置在磁盘配置层经sync×2仍保留的证据，不补齐3.8的私有org/session-links矩阵或6.1完整loader门禁。整体升级保持NO-GO。
