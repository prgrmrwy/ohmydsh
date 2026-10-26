## ADDED Requirements
### Requirement: 独立发布与商店身份一致
独立仓库 SHALL 同步当前默认策略和双语文档，版本 SHALL 与可安装包一致。商店 SHALL 只提交本插件单条准确YAML，未合并不能声称已上架。npm权限失败 MUST NOT 声称已发布；可使用版本钉住的GitHub预构建tgz作为安装入口。
#### Scenario: npm发布未授权
- **WHEN** 工作流验证通过但发布被registry拒绝
- **THEN** 保持npm实际latest事实，记录待用户完成绑定，GitHub Release与商店PR状态分别报告
