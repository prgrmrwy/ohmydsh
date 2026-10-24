# Pet真实介质writer排他与正常释放通过

## 规范与实现

openspec/specs/dsh-pet/spec.md93、111–117要求同一介质单Host写入、竞争者明确失败、无法取得保证时fail closed。实际host/storage/backend.ts112–133在写入连接上执行journal_mode=delete、locking_mode=EXCLUSIVE、BEGIN IMMEDIATE/COMMIT；125行将竞争错误映射为PetStorageError('medium-locked')。

不启动两个完整Host：它们会共享更多session/profile状态，超出本次SQLite验证边界。竞争者只加载候选实际built lib/host/storage/backend.js，申请介质所有权并whenReady/close，不open业务unit、不调用Task/Invocation/Locus或模型。

## 真实结果

对象为devbox验收root/fresh-fixed-home/plugins/dsh-pet/state.sqlite；路径realpath限制在隔离root，使用Node24.12.0。

1. 启动隔离0.2.0-rc.2完整Host PID2445911，端口39521。
2. 独立built backend进程2446552尝试同一介质：明确medium-locked，消息含refusing to start a second writer，exit0（按期望错误断言）。拒绝前后数据库SHA256相同。
3. 原Host继续执行真实Pet只读UI：面板/三空状态/轮盘打开关闭通过，读取请求均200，无pageerror、无变更路由。
4. 核cmdline与DSH_HOME后SIGTERM原Host，正常exit0。
5. 新built backend进程2447547成功whenReady，close后数据库SHA256与该探针开始前一致；只读DatabaseSync执行PRAGMA integrity_check得到ok，exit0。
6. 39521无监听；生产3080仍PID2004366；原repo clean。

Node打印SQLite experimental warning，未发生命令失败。

## 严格边界

这是一个真实完整Host持有介质、另一个实际构建backend跨进程被拒绝以及正常关闭后锁释放的证明。不是两个完整Host同时启动的degraded诊断验收，也没有验证SIGKILL/crash恢复、非空任务恢复、业务跨表原子提交、locus名额池或飞书链路。两次字节不变是各探针前后对照，不主张整个Host生命周期文件完全不写。

补充5.7 SQLite single-writer部分证据；5.7总项及5.1/5.6/5.8仍未完成。整体升级NO-GO，没有改本机DSH/VM、正式pin或发布。
