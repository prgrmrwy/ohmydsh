# Pet实际backend测试进程SIGKILL：提交边界恢复通过

## 测试安全范围与来源

仅在devbox验收root创建两个owner-only pet-crash-medium-*新目录/新数据库。使用83c69cf实际built PetStorageBackend，SHA256=df024297dbb4306faec08a2c47b1135af673709826850b08d01ec5157d80d702，Node24.12.0/真实SQLite。没有启动、杀死或操作任何Host，也没有打开现有Pet介质或调用模型/飞书。

子进程只对自己process.pid发SIGKILL，父进程spawnSync检查signal=SIGKILL/status=null/无timeout error；因此不是依赖命令失败猜测崩溃。探针整体exit0。

## 未提交边界

先用backend建立两表old数据与global generation=1并正常关闭。子进程重开后调用实际applyBatch，前三项写新记录、删除另一表old、更新global=2；第四项JSON.stringify调用测试value.toJSON，在该点写出owner-only边界标记并自发SIGKILL。

此时前面SQL已经执行，最后项尚未写入、COMMIT尚未执行，journal存在。没有替换backend代码或SQLite实现。

父进程重开同一介质：整个loadAll deepEqual旧基线，未提交insert/delete/global均回退。writer锁可取得，再写after_recovery成功，完整性ok。

## 已提交边界

第二个新介质相同基线，子进程正常await applyBatch前三项成功返回后自发SIGKILL，未执行backend.close。

父进程重开：loadAll deepEqual完整新基线（insert、delete和global均已提交）；可再写入，完整性ok。

该边界journal文件也存在。EXCLUSIVE连接可能保留journal文件，文件存在不等于hot journal或未提交事务；本次以实际await提交边界和完整重读状态判定，不用文件名误判。

## 限制

这是精确控制的测试进程在真实SQLite上的未提交/已提交故障恢复；不模拟断电、内核/磁盘故障或COMMIT系统调用中途；不是完整Host SIGKILL，也不验证Pet Task/Invocation恢复、domain事件重放、Locus名额池或飞书投递。

所有子进程均已回收；39521无监听，生产3080仍PID2004366，原repo clean。没有产品源码或正式pin修改。补充5.6介质故障原子性部分证据，整体Pet门禁未完成，升级NO-GO。
