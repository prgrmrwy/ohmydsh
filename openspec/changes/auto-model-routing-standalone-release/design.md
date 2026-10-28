## Context

动机见 proposal.md。当前包是 0.2.0/private，无 prepare/prepack；根 skills 的独立 manifest 行经 sync 复制到 DSH_HOME。现有 `tests/auto-model-routing-sync.test.mjs` 只证明两份文件被部署，不能证明 Host 真正收录 skill。现行规范的“skill 文本包含八项规则”还引用根 skills 路径。

依据：`skills/publish-dsh-plugin/SKILL.md`（发布 SOP 已内聚为 skill，原文档已迁移），sidebar-session-provider-icon 的发布 workflow、archify 的 filesystem bundle 范式，以及 `docs/architecture/dsh-plugin-integration-pitfalls.md`。涉及全局 Host provider 会进入 Pet scope 的已知限制，本 change 不修复宿主 scope 机制，也不添加强制派发拦截。

## Goals / Non-Goals

**Goals:**
- npm 与 Git 源码两种安装都能独立加载；只装插件即可发现同名 skill 一次。
- 迁移曾受管的全局副本而不删除私人副本或配置；保留现有路由行为。
- 用可复核版本、打包文件清单、镜像提交与申请链接串起发布证据。

**Non-Goals:**
- 不引入 submodule、不改远端消费、不改判档算法/模型表/默认模式。
- 不通过全局指令注入、hook 或新工具扩大“强制委派”能力；skill 是按需指引，不能保证 Agent 每次自主加载。
- 不重启生产 3080，不跑付费模型验收，不把第三方审核时效作为本地可保证结果。

## Decisions

### D1. subtree 镜像，ohmydsh 唯一真源
公开仓库为 `prgrmrwy/dsh-auto-model-routing`；仅推已提交的 package 子树，保持历史并核对公开作者身份和历史敏感信息。包内不得保留指向 monorepo 外部的相对链接。镜像版本 tag 必须指向子树提交，不能把 monorepo 根提交误打到镜像。拒绝 submodule 和远端消费方案，避免引入第二套部署/开发生命周期。

### D2. bundle 注册包内 filesystem provider
skill 放在 `packages/auto-model-routing/skills/subagent-model-routing/SKILL.md`，正文保持既有语义。bundle 在 insert 下新增具稳定 id 的 `@deepseek-ai/dsh-skill-filesystem` 行，配置唯一 providerName、`includeDefaultRoots:false`、包内 bundledSkillDir。利用已导出的 package.json 从 Loader 的 baseUrl 解析包路径，不拼接 cwd；补齐官方 provider 的 peer/dev 依赖。

删除独立 manifest skill 行及根源码副本，并更新所有当前测试/索引引用，历史归档不批量重写。先验证 sync 的既有 ownership ledger 会撤销旧副本；如不成立，实施最小受管迁移，不用无条件 rm DSH_HOME 路径。migration 测试必须从旧版本受管部署出发，不能只测干净目录。

选择 bundle 而非 Host 直接挂 provider，是为了复用已验证的 archify 装配路径，减少运行时代码。真实 catalog 需验证，不能以 YAML/文件存在替代；不得靠 profile 私有绝对路径补救安装失败。

### D3. 0.3.0 的发布内容与安装生命周期
去掉 private，补 MIT LICENSE（核对根仓许可/版权归属）、CHANGELOG、GitHub 元数据、双语 README、screenshots.json。`files` 显式包括 lib、patch、skills、许可证、README 双语、docs，以及文档承诺可运行的 label-report 脚本；eval 文档链接若未随 npm 打包则指向公开仓库。根外规范链接使用 ohmydsh GitHub 绝对 URL。独立仓库新增必要 .gitignore，避免 lib/node_modules 意外进入镜像提交。

prepare 与 prepack 都构建；npm 包必须自带可运行产物，Git 安装需明确 pnpm build approval。补齐所有宿主 imports 的 peer 声明，独立 npm install/typecheck/test/build 与打包后的入口解析用于捕获 monorepo hoisting 掩盖的依赖。

首次 npm 认证只用用户在本机安全配置的已授权身份。不能要求用户把 token 粘贴进聊天；现有可用登录优先，若首次发布需要 token，用户自行设短期最小权限凭据。首发存在后再绑定 Trusted Publisher；首次手动发布不声称具有 OIDC provenance。

### D4. release workflow 与外部上架边界
复制 sidebar-icon 模式：Node 24、支持 trusted publishing 的 npm、contents:read/id-token:write、tag/version 校验、install/test/typecheck、publish；支持 workflow_dispatch。镜像发布 workflow 不放 npm 长期 token。只有成功 OIDC 发布后的 attestations 才能作为 provenance 证据；同一版本不可重复发布，首发 0.3.0 手动成功后不再用同 tag 重发测试 OIDC。

执行前重新读取商店 contributing/schema，核对分类而非硬编码沿用此前猜测的 models；核对 README/GIF 图集格式支持，必要时从已有隔离录制制作真实静态封面并登记，不伪造截图。遵守实际仓库创建时间+最低年龄门槛；不忙等一天。缺少 npm 认证或年龄未到时记录具体下一步，其它不依赖任务继续。

所有公开新克隆显式设置 prgrmrwy/noreply 身份。申请完成与审核合并、网站探测分开记录，不夸大为全渠道上架。商店描述准确说明 effort-only、Jev 外部服务与 fail-closed，不声称免费、本地判档或必然节省 token。

## Risks / Trade-offs

- [旧 skill 副本导致重复] → 旧部署迁移 fixture + 真 Host catalog 唯一性，用户非受管同名副本只诊断，不越权删除。
- [全局 provider 在 Pet/executor 可见范围变化] → 按实际 catalog 检查并记录边界；不在本 change 宣称修复宿主已知 scope 缺陷。
- [skill 不会自动强制调用工具] → README 如实说明与 ohmydsh 环境规则的差异，不承诺一装包就强制每次派发判档。
- [新发行依赖缺失或 Git 安装没 build] → 干净独立目录与 tarball/Git 两条安装验证，显式 prepare/prepack。
- [外部审核、年龄、npm 权限阻塞] → 保留未完成任务及真实条件；不自动另起账号、不绕过认证、不重复发版。
- [正式部署影响活跃 AUTO 消费者] → 只在隔离 DSH_HOME 验证双 sync 与启停；生产部署/重启另行确认。

## Migration Plan

1. 实现 0.3.0 自包含 skill 与包文件，补迁移测试及安装说明。
2. 在临时 HOME/XDG/DSH_HOME 验证从旧受管 skill 升级、两次 sync no-op、禁用、数据保留与干净 Host 的 catalog；停止隔离进程并清理临时目录。
3. 验证所有本地检查、打包和独立安装后提交 ohmydsh，再建仓库/推已提交子树；不覆盖已有同名仓库或 npm 包。
4. 安全认证满足后首发 0.3.0，核验 registry/tarball；用户完成 OIDC 绑定。年龄和准入满足后提商店 PR、dsh.so 申请，留存轻量 verify 记录。
5. 本地实现与发布结果分别报告。外部步骤未完成则不宣称完整交付，不提前归档为全部完成。

回滚：恢复旧包版本、独立 skill 源和 manifest 行后 sync 并重新装配；保留用户数据。已公开 npm 版本不可“撤销成未发生”，使用后续修复版本或有理由的 deprecate；不自动删除公开仓库、强推改史或 unpublish。
