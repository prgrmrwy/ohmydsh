# Memory真实UI保存、Host回读与刷新：单场景通过

## 对象和边界

devbox隔离ohmydsh83c69cf候选0.2.0-rc.2，沿用已测试header/bridge修复，端口39521。Chromium1600×1000；无插件响应改写、API stub、force click、JS click或CSS覆盖。

本次仅编辑acceptance-scope的home为验收root下ui-memory-fixture。未创建卡片、发模型请求或更改生产配置。

## 执行证据

1. 页面Settings按钮可见后观察5秒，按已确认的welcome-notice启动生命周期等待初始化；普通打开Settings→Memory，再观察3秒并检查模态存在。
2. 精确定位acceptance-scope行，普通展开Show details，编辑input.dshmx-ident（home；不是同aria-label的scope name字段）。
3. 普通点击Save changes，观察真实`/api/settings/mutate` HTTP200且result.ok=true。
4. 独立settings/describe回读该scope.home，等于测试路径。
5. page.reload后按相同启动观察与普通UI步骤打开详情；home输入框值仍等于测试路径。
6. finally通过官方settings API恢复原scopes/workspaces，deepEqual检查通过；进程外第二个探针再次核对原快照，两字段均一致。

结果：uiLibraryPathSavedAndHostReadback=true、reloadShowsSavedValue=true、originalSettingsRestored=true。两次openMemory的启动观察后均没有再发生模态关闭。最终probe exit0。

## 保留失败历史

- 首次错误等待`settings/update`导致超时。官方config-form.ts139行实际调用remote.settings.mutate；这属于探针oracle错误，不能判产品保存失败。finally恢复后独立回读确认成功。
- 修正接口后的探针已完成保存/Host回读，但刷新后立即打开再次碰到启动期关闭，等待Memory按钮超时；finally恢复成功。
- 最终增加明确的5秒启动观察后整个保存/刷新链路通过。该固定等待只是本次有界验收前提，不是通用启动ready契约或产品修复；快速启动交互行为仍见settings-lifecycle-diagnosis.md。

## 未完成项

不覆盖session-links UI、私有org键共存及build×2矩阵、逐工作区路由/主入口/开关、卡片浏览或召回注入。3.8/4.5/6b.3保持未勾选。先前sync×2证据为另一轮API保存测试，不冒称本轮UI值经过sync×2。

候选PID2422617核身份后SIGTERM正常exit0；devbox生产3080仍PID2004366，repo clean。没有产品代码、正式pin、发布、合并或本机DSH/VM变更。整体升级仍NO-GO。

## 后续session-links入口核对：3.8仍不满足

devbox同来源0.2候选的settings/describe实际namespace列表无session-links/dsh-session-links；稳定启动后普通Settings模态也没有对应表单入口。未尝试任何设置写入，配置无需恢复。实际部署lib/index.js与repo构建cmp一致，排除观察了错版本的替代说明。

源码session-links/src/index.ts43–46只从loader config parseLinkRules，导出name/inject/apply，没有schema或Config；client/index.ts36–55只注册文档/资料sidebar tab，没有settings表单。该事实与tasks.md3.8、design.md84要求session-links实际设置编辑成功之间存在明确缺口。

repo-layout delta spec8要求配置表单编辑及sync后两类键仍生效，不能以Memory单场景或手改profile代替。当前报告只确定普通GUI/config-editor namespace入口缺失，未宣称所有外部配置编辑方式都不可用。未自动新增产品配置界面，也未静默删除3.8条件。下一步需要在既有升级实施范围内明确适用的官方编辑surface/配置schema，或经批准修订验收定义；私有org基线仍另缺。

候选PID2469481已核身份SIGTERM并exit0；生产3080仍PID2004366，原repo clean。本轮只读探针exit0，未创建Task或模型请求。
