## Decisions
0.4.0明确默认策略变化但保留现有MANUAL和legacy回滚。README沿原安装/使用/须知/架构/开发/移除结构双语对齐，移走开头旧四档与selectModel声明；旧GIF保留折叠并明确legacy/mock。无新生产截图避免暴露会话。

独立源镜像历史与monorepo重算subtree首提交不同（旧镜像1da9d24 vs源1127095），不能强推；merge保留两侧历史，冲突采用已验证当前源五个发布文件，独立install/typecheck/test/build通过后push6973e0d。

本机npm whoami E401，不读取token。调用既有release.yml workflow_dispatch让OIDC实际结果确认绑定。商店按现行贡献规则单条model类YAML，validateEntries全量通过；PR9455等待CI/审核，不能称上架。
