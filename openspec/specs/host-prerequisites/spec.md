# host-prerequisites Specification

## Purpose

本能力回答「这台机器还缺什么」：定制在 `dsh.yaml` 里声明自己需要的**机器本地运行前提**（首版只有全局
npm 包，精确版本 pin），sync 只校验声明形状，启动器在 start/`-b`/`build`/`restart` 前检查并补齐缺失或版本
不符的那一个版本，失败只告警、绝不阻塞启动，`dsh doctor [--check]` 是显式的手动入口。

它存在的理由是这类前提**不属于任何可同步资产**：`dsh build` 不装它（那是 profile 依赖），个人同步清单
不带它（那是仓库与配置），数据目录里也没有它（那是数据）——于是每台被重建、换新或恢复的机器都会静默
丢掉它。症状只出现在消费方：插件降级而非报错（例如 dsh-memex 的存储内核缺失后召回与写卡一起失败，
设置页只显示内部失败码）。因此这条链路的核心不是「装包」，而是**让机器级缺口的声明、修复与失败语义
都可追溯**：谁需要、要哪个版本、谁负责补、补不上时用户看到什么。

## Requirements

### Requirement: 定制在 manifest 中声明本机运行前提

定制 SHALL 能在 `dsh.yaml` 条目上用 `hostPrerequisites` 声明自己在本机运行所需的外部前提，
使「这台机器还缺什么」成为 manifest 的一部分，可随该定制一起启用、禁用与移除。

首版 SHALL 支持且仅支持 `kind: npm-global`：`{ kind, package, version, registry? }`。

校验规则（由 sync 在物化前执行，违规 MUST 报错并以非零状态结束）：

- 只允许出现在 `type: package` 的条目上；
- `package` SHALL 是合法 npm 包名（含作用域形式）；
- `version` SHALL 是**精确版本**，MUST NOT 是范围、标签或 `latest`；
- `registry` 可选，存在时 SHALL 是 http(s) URL；
- 同一 `(kind, package)` MUST NOT 在同一 manifest 中被声明两次；
- 未知 `kind` 或缺失字段 MUST 被拒绝，MUST NOT 静默忽略。

声明 SHALL NOT 改变物化产物：`dsh build` MUST NOT 因为 `hostPrerequisites` 而安装任何全局包。

#### Scenario: 合法声明通过校验
- **WHEN** 某 `type: package` 条目声明 `hostPrerequisites: [{ kind: npm-global, package: "@touchskyer/memex", version: "0.4.1" }]`
- **THEN** sync 以 0 结束，且 `dsh build` 期间不产生任何全局 npm 安装

#### Scenario: 版本范围被拒绝
- **WHEN** 某条目的 `hostPrerequisites[0].version` 是 `^0.4.1`、`latest` 或空字符串
- **THEN** sync 报错指出该条目与该字段，并以非零状态结束

#### Scenario: 未知 kind 被拒绝
- **WHEN** 某条目声明 `kind: homebrew`
- **THEN** sync 报错，不忽略该条目，也不按已知 kind 猜测处理

#### Scenario: 同一前提重复声明被拒绝
- **WHEN** 同一 manifest 的两个条目都声明 `kind: npm-global` + 同一个 `package`
- **THEN** sync 报错并指出冲突的两个条目

### Requirement: 启动前自愈，按定制的有效启用状态生效

启动器 SHALL 在**启动、构建、重启之前**检查并自愈所有**有效启用**定制的本机运行前提，
判定 MUST 与 sync 对 `enabled` / `enabledEnv` 的判定同源（同一实现，不得各写一套）。

未启用（`enabled: false` 且无覆盖，或被 `enabledEnv` 关闭）的定制 SHALL NOT 被检查或安装：
禁用一条定制 MUST NOT 在其机器上留下该定制带来的新装包。

没有任何声明时，检查 SHALL 不产生任何 npm 子进程。

幂等性：健康的前提 MUST NOT 触发安装；连续两次执行 MUST NOT 产生第二次安装。

#### Scenario: 缺前提时被装上
- **GIVEN** 某启用定制的 `hostPrerequisites` 声明 `@touchskyer/memex@0.4.1`，全局 root 下该包不存在
- **WHEN** 启动器走到启动前闸口
- **THEN** 执行一次 `npm install -g @touchskyer/memex@0.4.1`，随后该包在全局 root 下可见

#### Scenario: 已健康时不安装
- **GIVEN** 全局 root 下该包存在且 `package.json` 的 `version` 精确等于声明版本
- **WHEN** 启动器走到启动前闸口
- **THEN** 不执行任何安装命令，也不改动该包

#### Scenario: 定制被禁用时不安装
- **GIVEN** 声明该前提的定制 `enabled: false`（或 `enabledEnv` 把它关掉）
- **WHEN** 启动器走到启动前闸口
- **THEN** 既不检查也不安装，机器上不出现新装包

#### Scenario: 无声明时无 npm 子进程
- **WHEN** manifest 中没有任何 `hostPrerequisites`
- **THEN** 自愈不 spawn 任何 npm 进程

### Requirement: 健康判据与安装目标精确一致

判定一条 `npm-global` 前提健康 SHALL 同时满足：在**当前 node 的全局 npm root** 下该包目录可解析
（`realpath` 成功），且其 `package.json` 的 `version` **精确等于**声明版本。

版本不符 SHALL 视为不健康并安装声明版本，MUST NOT 视为「已安装、跳过」。
系统 MUST NOT 安装声明之外的版本，MUST NOT 用范围或 `latest` 兜底。

安装命令 SHALL 显式携带 registry，解析顺序为：条目 `registry` > 调用方 `npm_config_registry` /
`NPM_CONFIG_REGISTRY` > 仓库 `.npmrc` 的 `registry` > npm 默认。
（全局安装可能忽略仓库 `.npmrc`，因此 MUST 显式传参而不得依赖 cwd 的配置。）

#### Scenario: 版本不符时安装声明版本
- **GIVEN** 全局 root 下该包存在但版本是 `0.4.0`，声明为 `0.4.1`
- **WHEN** 执行自愈
- **THEN** 安装 `@touchskyer/memex@0.4.1`，且命令中不含任何范围或标签

#### Scenario: registry 按声明优先
- **GIVEN** 条目声明 `registry: https://registry.example/`，调用方同时设置了 `npm_config_registry`
- **WHEN** 执行安装
- **THEN** 安装命令使用条目声明的 registry

#### Scenario: 目录存在但包不可解析
- **GIVEN** 全局 root 下同名路径存在但不是有效包（缺 `package.json` 或无法 `realpath`）
- **WHEN** 执行自愈
- **THEN** 判定为不健康并尝试安装，不把它当作已满足

### Requirement: 自愈有界、失败不阻塞启动、可诊断

所有可能访问 registry 或安装的子进程 SHALL 有明确超时上限；超时 SHALL 终止其子进程树，
MUST NOT 无限等待。

安装失败、超时或校验失败 SHALL NOT 阻塞启动：启动器 SHALL 继续启动 Host，输出可操作的警告，
并把事件写入启动日志（记录定制 id、包名、声明版本与结果原因；MUST NOT 记录凭据或私密路径值）。
自愈过程本身 MUST NOT 使启动以非零状态结束。

启动器 SHALL 提供显式逃生门环境变量 `DSH_SKIP_HOST_PREREQUISITES`，置为真值时跳过自愈并说明已跳过。

#### Scenario: 安装失败仍启动
- **GIVEN** 安装命令以非零状态结束（网络不可达或 registry 拒绝）
- **WHEN** 启动器走到启动前闸口
- **THEN** 输出包含包名与声明版本的警告，启动日志留下记录，Host 照常启动

#### Scenario: 安装超时被终止
- **WHEN** 安装在超时上限内未结束
- **THEN** 终止该次安装的进程树，报告超时，不影响启动

#### Scenario: 逃生门跳过自愈
- **WHEN** 调用方设置 `DSH_SKIP_HOST_PREREQUISITES=1`
- **THEN** 不执行检查或安装，输出说明本次已跳过

### Requirement: 提供手动检查与修复入口

启动器 SHALL 提供 `dsh doctor`：执行与启动前相同的检查，缺前提时安装，并以退出码反映结果
（全部满足为 0，任一不满足为 1）。

`dsh doctor --check` SHALL 只读：只报告每条前提的状态，MUST NOT 安装、MUST NOT 修改全局 root。

#### Scenario: 手动修复
- **GIVEN** 全局 root 缺少声明的前提
- **WHEN** 运行 `dsh doctor`
- **THEN** 安装该前提并以 0 结束；再次运行不再安装

#### Scenario: 只读检查不改机器
- **GIVEN** 全局 root 缺少声明的前提
- **WHEN** 运行 `dsh doctor --check`
- **THEN** 报告缺失并以非零结束，且全局 root 与之前逐项相同

### Requirement: 声明版本与消费方要求不得漂移

manifest 声明的版本 SHALL 与消费该前提的包所要求的版本一致。
仓库 SHALL 以自动化检查暴露漂移（例如 `dsh-memex` 的 `KERNEL_VERSION` 与 `hostPrerequisites` 的
`version` 不一致时测试失败），MUST NOT 依赖人工记忆同步两处。

#### Scenario: 两处版本一致时通过
- **WHEN** `dsh.yaml` 声明 `0.4.1` 且 `dsh-memex` 生成物中的 `KERNEL_VERSION` 为 `0.4.1`
- **THEN** 该检查通过

#### Scenario: 漂移被发现
- **WHEN** 只改动其中一处版本
- **THEN** 检查失败并指出两处版本值，提示同步
