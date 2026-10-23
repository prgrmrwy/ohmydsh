## 1. 自包含 skill 与受管迁移

- [x] 1.1 为包内 skill 文本、bundle provider 配置、旧受管副本迁移/第二次 sync no-op、禁用后数据保留增加回归测试，确认旧实现不能满足新增场景。
- [x] 1.2 将 skill 源移到插件包，保持八项规则；在 bundle insert 中注册唯一 filesystem provider，声明对应 peer/dev 依赖并同步 lockfile。
- [x] 1.3 移除独立 skill manifest 条目和根源码副本；更新当前测试、双语索引与路径引用，保留历史归档；验证只撤销旧受管部署，不删除非受管副本。
- [x] 1.4 将包与 manifest 版本统一为 0.3.0，更新 trust note，保留原设置、模式、判档日志与全部路由语义。

## 2. 独立发布文件与文档

- [x] 2.1 移除 private，补 license/author/description/repository/homepage/bugs/keywords；核对根许可证后添加 LICENSE、CHANGELOG 和独立仓库 .gitignore。
- [x] 2.2 配置 prepare/prepack 构建和 files 清单，覆盖 lib、patch、skills、许可证、双语 README、docs、label-report；核对 eval 文档/资源的打包或绝对链接策略。
- [x] 2.3 保持 README 简洁及现有 GIF，改成 npm/Git 安装视角，披露兼容性、build approval、数据外发/脱敏限制及 skill 非强制性质，消除跨仓相对链接。
- [x] 2.4 添加 screenshots.json；执行时核对商店图集格式支持，必要时补隔离真实静态截图并完成隐私登记，不改测试白名单规避规则。
- [x] 2.5 添加包内 release.yml：Node/npm 版本、最小 OIDC 权限、tag/version 校验、install/test/typecheck/publish 与手动触发，不放 npm token。

## 3. 发布前独立验证

- [x] 3.1 运行 package test/typecheck/build、根 npm test、check:artifacts；区分已有失败与本次回归并记录真实结果。
- [x] 3.2 在不共享 monorepo node_modules 的临时目录从已准备包独立 install/typecheck/test/build，补齐暴露的依赖；检查 npm pack 文件清单及解包后的 Host/Web/skill/展示资源入口。
- [x] 3.3 使用临时 HOME/XDG/DSH_HOME 真实 Host，验证干净安装时 skill catalog 唯一、正文可加载、route_subagent 存在且 MANUAL 不外发；不得借用生产私有路径补丁让测试通过。
- [x] 3.4 在隔离旧部署上升级并连续 sync 两次，确认旧受管副本撤销、第二次 no-op、skill 唯一；禁用/重新装配后工具和 skill 消失且数据未变，记录非受管副本处理与实际 scope 可见性。
- [x] 3.5 停止并收集所有隔离进程，检查目标路径后清理临时文件；不重启生产实例，写入轻量 verify 记录。

## 4. 提交与公开镜像

- [x] 4.1 复核 GitHub/npm 名称仍可用、包当前树及拟公开子树历史无秘密/公司身份；新克隆设显式公开身份；提交并推送验证过的 ohmydsh 源码。
- [x] 4.2 创建 prgrmrwy/dsh-auto-model-routing 公开镜像，subtree 推已提交 package；设置默认 main、About/topics，记录源提交与镜像提交映射及 created_at。
- [x] 4.3 从镜像执行真实 Git 依赖安装并验证 prepare/build approval 与 bundle/skill 装配，不只测试手动复制目录。

## 5. npm 首发与长期认证

- [x] 5.1 安全检查现有 npm 登录与发布权限；不足时请用户仅在本机配置认证，记录待办，不索取聊天 token、不读取输出凭据内容。
- [x] 5.2 手动首发 0.3.0，核验正式 registry 版本、tarball 内容及独立安装；暂存/processing 不算成功且不重复发布，成功后在镜像正确子树提交创建版本 tag/Release，避免触发同版本重复发布。
- [ ] 5.3 由用户完成 npm Trusted Publisher 两步绑定（正确仓库、release.yml、Allow npm publish）；记录绑定状态，后续版本首次 OIDC 成功时再确认 attestations，不为测试而重复发布 0.3.0，不强制把尚未发生的 provenance 标为已验证。

## 6. 商店收录与交付

- [ ] 6.1 重新读取 awesome-dsh-plugin 当前贡献规则/类别/schema，核对差异化描述、包可加载与实际仓库年龄；本地 validateEntries 预校验通过后以公开身份提单条 YAML PR，记录链接和 CI。
- [x] 6.2 提交 dsh.so 自助申请，记录结果；其它 topic 爬虫只报告已配索引条件，不声称即时收录。
- [x] 6.3 更新根索引独立仓库链接及 verify 中的 npm/镜像/PR/网站可见性；年龄、认证、审核和探测等待分别列为未完成条件，禁止把“申请已提交”写成“已上架”。
- [x] 6.4 同步主规范的新增要求与 skill 路径，运行严格 OpenSpec 校验；按实际完成情况汇报，仍有必要外部待办则保持 change 未归档。
