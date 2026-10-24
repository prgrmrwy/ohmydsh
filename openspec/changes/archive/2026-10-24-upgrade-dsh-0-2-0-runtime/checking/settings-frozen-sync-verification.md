# 固定修复来源：Memory UI→sync×2→刷新完整单场景通过

## 固定候选而非修改正式pin

sync.mjs36、225行固定以脚本所在仓库为REPO并读取dsh.yaml；没有独立manifest CLI入口。manifest-overlay仅允许追加，不能覆盖已有id。

因此在devbox验收root创建独立完整副本frozen-sync-fixture（源83c69cf，cp -a --reflink=auto，无hardlink共享写入）。原repo保持clean。只改副本dsh.yaml：bridge spec指向7102a12 tgz、header spec指向已验证tgz，并为非npm header spec补name字段。副本含ACCEPTANCE-ONLY标记，未commit/push/publish，不是正式pin。

副本manifest SHA256：37fa4f8d3c738cff00133d1b0a54da137347a341d73ffb4294c910859c7dc0b0。
- bridge tgz：ee79a6fdbea6a19f8009d7fcafc1575fb91b5bee9ae0ef2db7d6aed99a5bfc78
- header tgz：d36f0ae88602db30bac0bee0e9d0e8ee57c99038356e21434c2935653750ae26

使用原隔离fresh-fixed HOME/DSH_HOME/XDG与39521；启动launcher仍来自原83c69cf，sync物化来源现在为frozen-sync-fixture。后续必须沿用该测试来源，不能用原manifest sync后仍假定修复产物在位。

## 真实验证结果

无插桩Chromium1600×1000，启动稳定观察后普通操作：

1. 展开acceptance-scope，编辑home为验收root/ui-memory-fixture。
2. 普通Save changes，settings/mutate200/result.ok，独立Host describe回读一致。
3. 从frozen-sync-fixture执行真实sync两次；第二次no changes。
4. cmp安装后的bridge client.js、header index.js与已验证修复构建一致。
5. 官方--dump-config中scope.home等于测试值，stderr为空。
6. 运行中Host describe再次回读一致。
7. page.reload，普通Settings→Memory展开；输入框仍显示测试值。
8. finally恢复原scopes/workspaces；独立进程再次deepEqual核对通过。

总探针exit0：uiSavedValueSurvivesSyncTwiceAndDump、liveHostAfterSync、reloadShowsSavedValue、originalSettingsRestored均true。没有force click、JS click、CSS改写、API保存替代UI。

## 清理与边界

候选PID2435673核cmdline/DSH_HOME后SIGTERM正常exit0；生产3080仍PID2004366。原repo clean、fixture diff --check通过、manifest hash复核一致。

前轮原manifest sync撤销临时bridge导致来源漂移的失败记录仍保留（settings-ui-sync-verification.md）。本轮闭合的是固定修复来源下Memory单home字段链路，不覆盖私有org键、session-links实际编辑、逐工作区开关/主入口或完整loader功能。3.8/4.5/6b.3保持未勾选；整体升级NO-GO。
