# 当前主干 bridge 0.5.2 与 Memory GUI 验收

## 边界和身份

本轮继续执行「本机改、devbox 验」。本机源码基线仍为 ohmydsh `b6e5c474` 加迁移及共享 patch 修复；devbox 只收本机打包的源快照、安装、构建和执行测试。未改正式 bridge/header pin，未 publish/push/切换生产。

- Bridge 发布基线：tag `dsh-cockpit-bridge-v0.5.2`，精确 `a18b3a414f74149d56652e0cd61d227d614c37d9`。
- 本机源码位置：`.validation/cockpit-052-local`。0.2 适配参照历史已审查的 `7102a12`，但不能整文件替换：它基于0.5.1，缺失0.5.2转发失败分型。
- 本机补丁只变 client 只读 observable 适配与回归。保留0.5.2版本、`PortForwardUnavailableError` / `PortForwardRejectedError`、本机/未握手零请求判断和仅 capability 失效续签。无 server/认证/转发协议改动。
- 验收环境：既有 `current-main-build-9fdFNcBd` 的专用 `sync-home`，39521；使用已审查 header 修复与本轮 bridge 验收包。不是正式可部署组合。

## 实测与根因

1. 正式0.5.2组合的Host认证200且无启动错误，但真实未改浏览器显示 `Failed to load plugins / dsh-cockpit-bridge`，整个原生设置入口不可用。Host200不能证明client boot。
2. 源码仍订阅已删除的 `uiSession.pendingInteractions`。新0.2形状回归在修复前报 `TypeError ... undefined (reading 'subscribe')`，既有27项通过。
3. 本机修复新旧选择/pending投影、初始化清理、dispose后异步读取及in-flight snapshot丢更新。devbox最终 **34/34 PASS**，shared build、bridge typecheck/build PASS。
4. 验收包通过官方 plugin add 安装到专用profile，lib/client.js逐字节cmp通过。最终验收tarball SHA256 `20e1c1cfc2db09d8a38f61bcb6318e2e1c67f34a11cbe087e92d743b75a06099`。首次安装因PNPM_HOME未继承产生unexpected store；用该profile原有store环境重试成功，未重装/清空生产。
5. 首次组合sync已产生含UI保存值的官方dump，但源manifest仍指向正式bridge0.5.2，sync按声明重装了未修复发布物，cmp明确失败；不绕过cmp、不把该轮称作完整通过。后续使用本机编写的**验收专用manifest**明确指向本轮tarball，传至devbox临时装配并finally恢复候选源码manifest。此manifest不进入正式部署。
6. 未改浏览器完整boot与真实Memory页面通过，pageerror为空。页面实际编辑personal库路径，官方settings/mutate200、Host立即回读一致、刷新后字段一致；探针finally恢复原scopes并回读验证。Host SIGTERM退出code0。

## 批次源码审查

对精确0.5.2基线的全量client/test diff审查：新增适配不改数据外发边界，只投影sessionId/kind/key；无未知来源时不伪造空snapshot。既有0.5.2错误分型和续签行为回归原样保留，新0.2组合同时验证这两类行为。类型检查、构建与34项测试支持该范围；不能证明真实Cockpit的pending/选择端到端，也不证明私有org/workspace矩阵。

已交付可应用到精确0.5.2 tag的源码/测试补丁：`deliverables/dsh-cockpit-bridge-0.5.2-dsh-0.2-compat.patch`。修复源保存在本机，不将远端源码vendor入生产包。

正式发布仍需独立批准与精确产物审查。本机未发布补丁不得写入正式pin。最终真实GUI链路通过：**页面保存 → Host立即回读 → sync×2（第二次no changes）→ official dump保留值 → 浏览器刷新重开仍显示值**。同期header/bridge验收构建cmp通过，pageerror为空，finally恢复原scopes，Host正常退出。验收manifest的本地tarball spec须使用`file:`规范形态，裸绝对路径会因pnpm规格规范化导致重复spec drift，不是配置所有权损坏。

这证明当前主干Memory GUI持久化链路，但未包含私有org键共存、真实逐工作区路由/主入口/开关、卡片浏览/召回注入、完整Cockpit与Pet会话行为；3.8、4.5、6b.3仍不整体勾选。整体升级仍NO-GO。

## 后续无第三方源码patch组合复验

2026-10-07用户再次明确：第三方插件不改源码、不为header/cost打DSH patch；**bridge是自研，允许单独适配**。cost-meter改正式1.8.4，与原样header0.1.0共存；不再用未发布header修复。既有本机bridge0.5.2源码适配重新在devbox跑34tests/typecheck/build全部通过，未扩大代码改动、未发布。

新组合实际页面保存→Host读回→sync×2第二次no changes→official dump→刷新路径全部通过，errors=[]、finally恢复原scopes、SIGTERM code0。sync同时cmp原header0.1.0通过，dump cost/header各一条。第一次嵌套sync因HOME已切换导致验收root错误，是本机探针脚本问题；改为继承ACCEPTANCE_ROOT后重跑成功，未修改远端插件/DSH源码或放宽断言。正式bridge pin仍0.5.2公开产物，候选验收spec仅指向临时本地tarball，因此仍不构成完整生产GO。同期devbox既有当前主干候选源复跑整仓npm test：321tests/319pass/2skip/0fail；该源快照与此前根回归一致，不能冒称已对尚未提交的本机最终Git快照做过清洁构建。
