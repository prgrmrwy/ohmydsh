# ohmydsh-worktree-preview Specification

## Purpose
定义 ohmydsh 仓库的 `.ws/prepare-preview`：在需要验收时（经 `ws prepare-preview` 按需触发），把真实 DSH home 中运行所需的配置按白名单带入隔离 home，并分配独立预览端口，使 worktree 内启动的 DSH 无需重新初始化即可用于合入前验收；同时约束 launcher，防止 worktree 操作日常 Host。

## Requirements

### Requirement: Prepare-preview seeds runtime configuration by an explicit allowlist
ohmydsh 的 `.ws/prepare-preview` SHALL 只写入 `WS_DSH_HOME` 与本 worktree 的 `.env.local`，并且只在 `WS_DSH_HOME` 位于 `<WS_GIT_COMMON_DIR>/ws/dsh-home/` 下、且与 `WS_SOURCE_DSH_HOME` 不是同一目录时才写；否则 MUST 以非零状态退出且不写任何文件。它 SHALL 从真实 home（`WS_SOURCE_DSH_HOME`）把以下内容复制为快照写入隔离 home：
- `.credentials.yaml`，来源中的 `client-connection/browser-session` record MUST NOT 复制，隔离 home 中已有的同名 record MUST 保留原值；
- `plugins/subscriptions/` 下的 `auth.json`（原样复制，含 refresh token）、`models.json`、`model-defaults.json`、`provider-settings.json`；
- `profiles/web/cordis.patch.yml` 生成区之外、id 命中白名单的行：默认模型、LLM provider、子会话模型白名单、权限预设、`dsh-memex`；
- `profiles/web/.npmrc` 的 registry 行；
- `plugins/dsh-auto-model-routing/config.json`。

白名单在仓库中以单一声明维护。白名单之外的内容 MUST NOT 复制，包括 `sessions/`、`storages/`、`state/` 和日志。复制 MUST 是独立文件，不得使用链接；写入文件权限 MUST 为 0600。

#### Scenario: Fresh worktree reaches a usable model without setup
- **WHEN** 用户在 worktree 中依次执行 `dsh build`、`ws prepare-preview`、`dsh`
- **THEN** 启动的 Host SHALL 直接使用与真实 home 相同的默认模型与 provider，MUST NOT 停在要求输入 API Key 或选择模型的初始化流程

#### Scenario: Sessions and history are never copied
- **WHEN** prepare-preview 完成
- **THEN** 隔离 home 中 MUST NOT 出现来自真实 home 的 Session 记录、`storages/` 或 `state/` 内容

#### Scenario: Target equal to the real home is refused
- **WHEN** `WS_DSH_HOME` 不在 `<WS_GIT_COMMON_DIR>/ws/dsh-home/` 下，或与 `WS_SOURCE_DSH_HOME` 指向同一目录
- **THEN** 脚本 SHALL 以非零状态退出，且 MUST NOT 写入任何文件

#### Scenario: Missing source item is skipped, not invented
- **WHEN** 白名单中的某一项在真实 home 中不存在
- **THEN** prepare-preview SHALL 跳过该项并在输出中列出，MUST NOT 生成默认值

### Requirement: Prepare-preview requires an initialized profile
prepare-preview 只修改隔离 home 中已存在的 profile 文件，MUST NOT 自行创建 profile 骨架。隔离 home 中不存在 `profiles/web/package.json` 时，脚本 MUST 以非零状态退出，不写任何文件，并提示先在 worktree 中执行 `dsh build`。

#### Scenario: Fresh worktree without a build is told to build first
- **WHEN** 新 worktree 从未执行过 `dsh build`，用户调用 `ws prepare-preview`
- **THEN** 脚本 SHALL 失败并提示先执行 `dsh build`，隔离 home MUST 保持不变

#### Scenario: Browser session of the preview Host is preserved
- **WHEN** 真实 home 与隔离 home 的 `.credentials.yaml` 都含有 `client-connection/browser-session`，且值不同
- **THEN** 合并后，隔离 home 中该 record SHALL 仍为隔离 home 原有的值，真实 home 的值 MUST NOT 出现在隔离 home 中

### Requirement: Subscription login risk is disclosed
prepare-preview 复制订阅 `auth.json` 时 SHALL 原样保留 refresh token，因为订阅插件会丢弃缺少 refresh token 的账号。脚本 SHALL 在输出中列出每个账号的剩余有效期，并提示：预览中如发生刷新，部分订阅（如 codex）的登录可能在日常 GUI 中失效，需要重新登录。真实 home 的 `auth.json` MUST NOT 被修改。

#### Scenario: Subscription accounts load in the preview
- **WHEN** 真实 home 有有效的 claude 或 codex 订阅账号，执行 prepare-preview 后启动预览 Host
- **THEN** 这些账号 SHALL 在预览中可用，MUST NOT 因字段缺失被插件跳过

### Requirement: Re-running prepare-preview refreshes seeds and keeps preview-local state
重复执行 prepare-preview SHALL 用真实 home 的当前内容覆盖受管项。`cordis.patch.yml` 只替换白名单 id 对应的行，生成区与其它行保持原样。隔离 home 中由预览 Host 自己产生的 Session、日志和 `client-connection/browser-session` MUST 保留。真实 home 未变时，重复执行 MUST 不改变任何文件内容。

#### Scenario: Real-home model change propagates on the next prepare-preview
- **WHEN** 用户在真实 home 改了默认模型，然后在绑定 Session 中执行 `ws prepare-preview`
- **THEN** 隔离 home 的默认模型 SHALL 更新，之前预览中创建的 Session 仍然存在

#### Scenario: Repeated prepare-preview is idempotent
- **WHEN** 真实 home 未变化，连续执行两次 prepare-preview
- **THEN** 第二次 SHALL 不改变隔离 home 中任何文件

### Requirement: Prepare-preview records a preferred preview port
prepare-preview SHALL 为 worktree 登记一个首选预览端口 `DSH_PORT`，写入 worktree `.env.local` 中 prepare-preview 自有的托管块：已有时沿用；否则按 operationId 的稳定哈希映射到预览区间（3180–3279），使不同 worktree 的首选端口天然分散。首选端口只是起点，不承诺独占；实际端口在启动时决定（见下一条要求）。prepare-preview MUST NOT 依赖端口探测来保证唯一性。

#### Scenario: Preferred port is stable across re-runs
- **WHEN** 同一 worktree 重复执行 `ws prepare-preview`
- **THEN** `DSH_PORT` SHALL 保持不变，即使预览 Host 正在该端口运行

### Requirement: Preview Host start backs off to the next free port
在隔离 home 下、未显式传 `--port` 启动时，launcher SHALL 从首选端口开始，在预览区间内依次向后偏移（到区间末尾后回绕），直到成功启动一个由本次启动进程拥有的 Host 为止。以下情况 SHALL 视为该端口不可用并继续偏移：端口已被监听（无论是否为 DSH）、启动后该端口的监听者不是本次启动的子进程。launcher MUST NOT 为腾出端口而终止任何不属于本 worktree 的进程，也 MUST NOT 把其它进程的 Host 报告为自己启动成功。尝试次数 SHALL 有上限；超过上限或区间耗尽时 MUST 以非零状态退出并说明原因。启动成功后，launcher SHALL 把实际端口与进程身份（pid、启动时间）记录到隔离 home 的预览记录中，并在输出中打印实际端口与 URL。显式传 `--port` 时 SHALL 只尝试该端口，不偏移。

#### Scenario: Concurrent previews land on different ports
- **WHEN** 两个 worktree 的首选端口相同，几乎同时执行 `dsh`
- **THEN** 两者 SHALL 各自运行在不同端口上，每个 worktree 报告的都是自己子进程监听的端口

#### Scenario: Preferred port taken by another program
- **WHEN** 首选端口已被一个无关进程或另一个 worktree 的预览 Host 占用
- **THEN** launcher SHALL 偏移到下一个可用端口启动，且 MUST NOT 终止占用者

#### Scenario: Explicit port does not back off
- **WHEN** 用户显式执行 `dsh --port 3200` 而 3200 已被占用
- **THEN** launcher SHALL 按既有语义处理该端口，不偏移到其它端口

### Requirement: Preview stop and restart act only on the recorded own Host
在隔离 home 下执行 stop 或 restart（未显式传 `--port`）时，launcher SHALL 以预览记录中的端口为目标，且仅当该端口当前监听者与记录的 pid 和启动时间一致时才发出终止信号；不一致时 SHALL 视为本 worktree 没有运行中的预览 Host，清除过期记录，MUST NOT 终止该端口上的进程。restart 在停止后 SHALL 优先尝试原端口，再按退避规则偏移。

#### Scenario: Stop never kills a neighbour that reused the port
- **WHEN** 本 worktree 的预览 Host 已退出，另一个 worktree 的预览 Host 随后占用了同一端口，用户在本 worktree 执行 `dsh stop`
- **THEN** launcher MUST NOT 终止该进程，并报告本 worktree 没有运行中的预览 Host

### Requirement: Launcher guards the daily Host from worktrees
launcher 在未显式传 `--port` 且不在隔离 home 下时，SHALL 使用 `DSH_PORT`（若有）否则 3080。当解析出的 `DSH_HOME` 位于 `<git-common-dir>/ws/dsh-home/` 之下时：目标端口为 3080（含显式 `--port 3080`、或没有 `DSH_PORT`）的 start、restart、stop MUST 在产生任何副作用前以非零状态拒绝，并提示先执行 `ws prepare-preview`；退避过程 MUST NOT 偏移到 3080。`dsh build` 不受此限制，但输出 SHALL 标明目标是隔离 home、日常 GUI 未更新。在隔离 home 下启动成功时，输出 SHALL 打印隔离 home 绝对路径、实际端口与"隔离预览环境"标识，并打印一行机器可读的 `DSH_PREVIEW {"url":…,"port":…,"home":…}`。

#### Scenario: Restart from a prepared worktree only touches its preview Host
- **WHEN** 日常 Host 在 3080 运行，用户在已执行过 `ws prepare-preview` 的 worktree 中执行 `dsh restart`
- **THEN** 只有该 worktree 记录的预览 Host 被重启，3080 上的进程 SHALL 保持不变

#### Scenario: Worktree without a preview port cannot touch 3080
- **WHEN** worktree 的 `.env.local` 中没有 `DSH_PORT`，用户在其中执行 `dsh restart`
- **THEN** 命令 SHALL 拒绝，且 MUST NOT 停止或启动任何进程

### Requirement: Teardown stops only the recorded preview Host
ohmydsh 的 `.ws/teardown-preview` SHALL 读取隔离 home 中的预览记录。只有当记录端口当前的监听者与记录中的 pid 和启动时间都一致时，才 SHALL 停止该进程；不一致、没有记录或进程已退出时，MUST NOT 发送任何信号，并以成功状态退出。脚本 MUST NOT 终止任何不在预览记录中的进程。

#### Scenario: Teardown leaves a neighbour on the same port alone
- **WHEN** 本 worktree 的预览 Host 已退出，另一个 worktree 的预览 Host 随后占用了同一端口，此时 ws clean 调用 teardown-preview
- **THEN** 脚本 MUST NOT 终止该进程，并以成功状态退出
