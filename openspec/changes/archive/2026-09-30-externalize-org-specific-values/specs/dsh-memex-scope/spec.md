## ADDED Requirements

### Requirement: remote 派生库的发布方向由配置的内部 host 决定

按 remote 自动派生的库 SHALL 在且仅在其 `origin` 的 host 属于部署配置的内部 host（插件行 `config.internalHosts`）时，
取发布方向为内部；否则 SHALL 为外部。源码 MUST NOT 内置任何组织的 host。

#### Scenario: 配置的内部 host 派生内部库
- **WHEN** 部署配置内部 host `git.corp.example`，cwd 所在仓库的 origin 为 `git@git.corp.example:team/acme.git`
- **THEN** 派生出 scope `team-acme`，发布方向为内部

#### Scenario: 未配置时同一仓库派生外部库
- **WHEN** 部署未配置内部 host，cwd 所在仓库的 origin 同上
- **THEN** 派生出同名 scope，发布方向为外部（因此写入受守门）

#### Scenario: 公开平台仓库始终外部
- **WHEN** 部署配置了内部 host，cwd 所在仓库的 origin 位于 `github.com`
- **THEN** 派生库的发布方向为外部
