# startup-autoupdate Specification

## Purpose

DSH 启动/构建入口在每次运行时自动检测 registry 上的最新 DSH 版本;一旦发现更新且仓库工作区干净,阻塞式完成「改 `dsh.yaml` pin 与同族版本 → 重跑 sync 物化 → 自动 commit」后再继续启动,保证日常尽量从最新 DSH 版本开始,同时通过开关、脏工作区跳过与失败即停保留人工控制。

## ADDED Requirements

### Requirement: autoUpdate 开关与追踪频道可配置

manifest 顶层 `autoUpdate` 映射必须(SHALL)支持布尔 `enabled` 与字符串 `channel` 两个字段。未配置 `autoUpdate` 时视为启用、`channel` 默认 `latest`;`autoUpdate.enabled: false` 或环境变量 `DSH_SKIP_UPDATE=1` 时必须完全跳过版本检测。`channel` 取 registry 的 dist-tag(`latest` 或 `next`),环境变量 `DSH_UPDATE_CHANNEL` 必须以最高优先级覆盖 manifest 中的 `channel`。

#### Scenario: 默认启用并追踪 latest

- **WHEN** `dsh.yaml` 不含 `autoUpdate` 字段时运行 `dsh`
- **THEN** 启动器执行版本检测,以 registry 的 `latest` dist-tag 为追踪目标

#### Scenario: 显式关闭

- **WHEN** `autoUpdate.enabled: false` 或设定了 `DSH_SKIP_UPDATE=1`
- **THEN** 启动不做任何检测,直接按当前 `dshVersion` 执行

#### Scenario: 频道覆盖

- **WHEN** `DSH_UPDATE_CHANNEL=next dsh` 且 manifest 中 `channel: latest`
- **THEN** 检测以 registry 的 `next` dist-tag 为追踪目标

### Requirement: 启动与构建入口执行版本检测

启用且未跳过时,`dsh`(server 未运行)、`dsh -b`、`dsh build` 三个入口在各自动作前必须(SHALL)查询 registry 目标频道的最新版本并与当前 `dshVersion` 比较。检测失败或离线时必须警告并继续按当前 pin 执行,不得阻塞。start 入口在 server 已运行时(仅打开 UI)不得触发检测。

#### Scenario: 启动前检测

- **WHEN** 运行 `dsh` 且 server 未运行、autoUpdate 启用
- **THEN** 在拉起 server 前完成 registry 最新版本查询与比较

#### Scenario: 已运行时不重复检测

- **WHEN** 运行 `dsh` 且 server 已在运行
- **THEN** 只打开 UI,不执行版本检测

#### Scenario: 离线容错

- **WHEN** registry 查询失败或超时
- **THEN** 打印警告并以当前 `dshVersion` 正常启动,不中断

### Requirement: 语义化版本比较决定是否更新

版本比较必须(SHALL)遵循语义化版本规则,含预发布数字序(`rc.9` < `rc.10`)。当前 `dshVersion` 已是最新时不得做任何改写或重建动作。

#### Scenario: 发现可更新版本

- **WHEN** 目标频道最新版本大于当前 `dshVersion`
- **THEN** 进入自动升级流程(或按脏工作区规则跳过)

#### Scenario: 已是最新

- **WHEN** 目标频道最新版本不大于当前 `dshVersion`
- **THEN** 直接继续原动作,输出不含任何更新事件

### Requirement: 自动升级仅在工作区干净时执行

检测到更新后,启动器必须(SHALL)检查仓库 git 工作区(`git status`)是否包含任何未提交或未跟踪改动。存在改动时必须跳过自动升级,并在输出中说明检测到的新版本、跳过原因与再次触发条件;不得改动 `dsh.yaml`、不得重跑 build、不得提交。

#### Scenario: 工作区干净则升级

- **WHEN** 检测到更新且 `git status` 为空(无未提交/未跟踪改动)
- **THEN** 执行完整自动升级流程后继续启动

#### Scenario: 工作区有改动则跳过并说明

- **WHEN** 检测到更新但 `git status` 存在任何改动
- **THEN** 跳过自动升级,启动/构建正常进行,并在输出中写明「检测到新版本 <X>,仓库有未提交改动已跳过,提交后可自动」

### Requirement: 升级改写 manifest 并联动同族版本

自动升级必须(SHALL)以行级文本方式改写 `dsh.yaml`(保留注释与整体结构):将 `dshVersion` 改为目标版本;对名字匹配 `@deepseek-ai/dsh-*` 且当前 pin 等于旧运行体版本的位置(顶层 `dependencies` 的 spec、`package` 定制条目的 `spec` 与 `version`)一并改写为目标版本。名字不匹配或 pin 与旧运行体不一致的条目不得改动。改写前必须(SHALL)生成 `dsh.yaml.bak` 备份。

#### Scenario: 联动同族依赖

- **WHEN** `dshVersion` 从 `0.1.0-rc.6` 升到 `0.1.0-rc.7`,且顶层存在 `@deepseek-ai/dsh-sdk-protocol@0.1.0-rc.6`
- **THEN** 该依赖的 spec 一并改写为 `@0.1.0-rc.7`,第三方包(如 `dsh-cost-meter@1.5.6`)保持不变

#### Scenario: 保留刻意钉住的旧版

- **WHEN** 某 `@deepseek-ai/dsh-*` 条目的 pin 不等于旧运行体版本(如刻意钉在 `rc.8`)
- **THEN** 该条目不被自动改写

#### Scenario: 备份先行

- **WHEN** 自动升级改写 `dsh.yaml` 前
- **THEN** 已存在内容与改写后一致的 `dsh.yaml.bak`,可用于回滚

### Requirement: 升级后重物化并自动提交

改写后必须(SHALL)重跑 sync 物化定制。sync 失败时,必须(SHALL)从 `dsh.yaml.bak` 恢复 `dsh.yaml`,以错误退出且不启动。sync 成功后,若工作区相对改写前仅含 `dsh.yaml` 一处改动,必须(SHALL)自动 `git commit --no-verify`(跳过 pre-commit 钩子),message 取 `chore(dsh): auto-bump <旧> → <新>`;commit 失败(如缺少 git 身份、签名失败)时必须(SHALL)以错误退出且不启动,并提示手动处理方式。

#### Scenario: build 失败回滚且不启动

- **WHEN** 改写 `dsh.yaml` 后 sync 报错
- **THEN** `dsh.yaml` 从备份恢复,启动器以错误退出,不启动 server

#### Scenario: 成功升级并提交

- **WHEN** 改写后 sync 成功且工作区干净(仅 `dsh.yaml` 变化)
- **THEN** 自动生成 commit `chore(dsh): auto-bump 0.1.0-rc.6 → 0.1.0-rc.7`,随后按原入口继续(start 拉起 server / build 完成)

#### Scenario: commit 失败即停

- **WHEN** 自动 commit 因 git 原因失败
- **THEN** 启动器以错误退出、不启动,并在输出中提示手动 commit 或回滚的处置方式

### Requirement: 升级与跳过事件可追溯

启动日志(`dsh history` 读取的 `$DSH_HOME/dsh-startup.log`)必须(SHALL)记录 autoUpdate 事件:成功升级(旧版本 → 新版本、频道)、因工作区脏而跳过(新版本与原因)、离线检测失败。

#### Scenario: 记录升级

- **WHEN** 自动升级完成一次 `0.1.0-rc.6 → 0.1.0-rc.7`
- **THEN** 启动日志新增一行 autoUpdate 事件,含旧版本、新版本与频道

#### Scenario: 记录跳过

- **WHEN** 因工作区脏跳过自动升级
- **THEN** 启动日志新增一行含新版本号与跳过原因的 autoUpdate 事件
