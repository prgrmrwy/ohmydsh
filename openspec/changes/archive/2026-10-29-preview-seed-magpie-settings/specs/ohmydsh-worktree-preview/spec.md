## MODIFIED Requirements

### Requirement: Prepare-preview seeds runtime configuration by an explicit allowlist
ohmydsh 的 `.ws/prepare-preview` SHALL 只写入 `WS_DSH_HOME` 与本 worktree 的 `.env.local`，并且只在 `WS_DSH_HOME` 位于 `<WS_GIT_COMMON_DIR>/ws/dsh-home/` 下、且与 `WS_SOURCE_DSH_HOME` 不是同一目录时才写；否则 MUST 以非零状态退出且不写任何文件。它 SHALL 从真实 home（`WS_SOURCE_DSH_HOME`）把以下内容复制为快照写入隔离 home：
- `.credentials.yaml`，来源中的 `client-connection/browser-session` record MUST NOT 复制，隔离 home 中已有的同名 record MUST 保留原值；
- `plugins/subscriptions/` 下的 `auth.json`（原样复制，含 refresh token）、`models.json`、`model-defaults.json`、`provider-settings.json`；
- `profiles/web/cordis.patch.yml` 生成区之外、id 命中白名单的行：默认模型、LLM provider、子会话模型白名单、权限预设、`dsh-memex`；
- `profiles/web/.npmrc` 的 registry 行；
- `plugins/dsh-auto-model-routing/config.json`；
- `plugins/dsh-magpie-connector/settings.json`（连接线路与可见模型；其 key 已随 `.credentials.yaml` 复制）。

白名单在仓库中以单一声明维护。白名单之外的内容 MUST NOT 复制，包括 `sessions/`、`storages/`、`state/` 和日志。复制 MUST 是独立文件，不得使用链接；写入文件权限 MUST 为 0600。

#### Scenario: Fresh worktree reaches a usable model without setup
- **WHEN** 用户在 worktree 中依次执行 `dsh build`、`ws prepare-preview`、`dsh`
- **THEN** 启动的 Host SHALL 直接使用与真实 home 相同的默认模型与 provider，MUST NOT 停在要求输入 API Key 或选择模型的初始化流程

#### Scenario: Magpie connector lines reach the preview
- **WHEN** 真实 home 存在 `plugins/dsh-magpie-connector/settings.json`，执行 prepare-preview
- **THEN** 隔离 home 中 SHALL 出现内容相同、权限 0600 的独立副本，真实 home 的文件 MUST NOT 被修改

#### Scenario: Sessions and history are never copied
- **WHEN** prepare-preview 完成
- **THEN** 隔离 home 中 MUST NOT 出现来自真实 home 的 Session 记录、`storages/` 或 `state/` 内容

#### Scenario: Target equal to the real home is refused
- **WHEN** `WS_DSH_HOME` 不在 `<WS_GIT_COMMON_DIR>/ws/dsh-home/` 下，或与 `WS_SOURCE_DSH_HOME` 指向同一目录
- **THEN** 脚本 SHALL 以非零状态退出，且 MUST NOT 写入任何文件

#### Scenario: Missing source item is skipped, not invented
- **WHEN** 白名单中的某一项在真实 home 中不存在
- **THEN** prepare-preview SHALL 跳过该项并在输出中列出，MUST NOT 生成默认值
