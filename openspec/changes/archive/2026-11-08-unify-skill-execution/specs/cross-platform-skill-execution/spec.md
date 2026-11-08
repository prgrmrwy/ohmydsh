## Purpose

使 ws 与 memex 报告辅助技能可在原生 Windows、macOS、Linux 中用同一 Node 入口执行；保留 CLI 发现、多库选择、参数与退出状态，避免日常调用依赖 Bash 或安装额外工具。

## ADDED Requirements

### Requirement: Skill helper execution is native and preserves arguments

两种辅助入口 SHALL 可直接由 Node 执行，且部署后不依赖仓库外的自定义模块。旧sh SHALL 只向相邻 Node 入口转发。CLI SHALL 按 PATH 优先、已部署来源（memex profile）、当前仓库构建产物顺序查找；Windows SHALL 用真实JS或exe，不拼接Shell执行cmd/ps1。调用参数、cwd、环境和失败状态 SHALL 保留；缺CLI SHALL 非零给出部署指引，不自行安装。ws入口只做发现/转交，不扩展任何维护授权。

#### Scenario: Native entry forwards literal arguments
- **WHEN** 无Bash环境在含空格与Unicode的cwd执行辅助入口，传入引号、空值和Shell元字符
- **THEN** CLI逐项收到原argv与cwd，不产生额外命令，非零状态被传播

#### Scenario: Missing or shim-only unsupported CLI
- **WHEN** 找不到受支持CLI，或Windows只有无法证明对应包入口的shim
- **THEN** 辅助入口非零诊断且未安装、未执行Shell

### Requirement: Memex report keeps multi-library semantics

无显式--lib时报告 SHALL 为home下每个有cards目录的普通库执行一次，默认排除eval-*库并报告排除数；显式--lib、--lib=形式或help SHALL 原样直传且不枚举库。多库中某次失败 SHALL 不阻止后续库并保留最后失败状态。无可用普通库或无法读取库根 SHALL 非零给出诊断。CLI与库枚举 SHALL 不写用户文件、不联网。

#### Scenario: Multiple libraries with an individual failure
- **WHEN** 普通库、eval库和非库目录并存，其中一份报告失败
- **THEN** 每个普通库执行一次，eval与非库不执行，后续库继续且最终保留失败码

#### Scenario: Explicit library bypasses default exclusion
- **WHEN** 显式传入eval库或help
- **THEN** 参数原样只执行一次，无默认库枚举
