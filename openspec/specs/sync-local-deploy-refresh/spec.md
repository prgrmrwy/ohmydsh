# sync-local-deploy-refresh Specification

## Purpose
`dsh build` 物化 local 包时,保证**当前源码的**构建产物能忠实上线。两道相互独立的关卡共同成立:其一,源目录产物必须仍是本机上一次成功构建的产出,否则先重新构建;其二,部署副本(node_modules 下)的发布字节必须与源目录发布字节一致,不一致时自动"隔离旧副本 + 重装 + 失败恢复"。前者消除"陈旧产物被当作合法结果部署"的问题,后者消除 pnpm `file:` 目录依赖合并不覆盖导致的"构建产物从未上线"问题;缺少任何一道,另一道都只能证明两份同样陈旧的产物彼此相等。

## Requirements

### Requirement: 构建产物必须可证明与当前源码同代

系统 SHALL 在部署 local package 之前，确保其源目录构建产物仍是本机上一次成功构建所产出的那一份。为此，系统 SHALL 在每次成功构建后持久记录该次构建**实际产出**的发布内容哈希（下称"产物记录"），并在后续运行中把该记录与当前磁盘上产物的发布内容哈希比对：不一致 SHALL 重新构建。

判定 MUST NOT 仅依据"源码构建输入相对上一次 sync 是否变化"或"构建产物目录是否存在"，也 MUST NOT 仅依据描述构建来源的间接标识（源码输入哈希、源目录路径等）。这些条件都不描述产物本身：源码相同而产物来自别处时它们全部命中，而既有的部署副本一致性校验此时只能证明两份同样陈旧的产物彼此相等，从而让陈旧产物通过全部检查并上线。

无法证明时 SHALL fail closed，即重新构建：产物记录缺失（含从旧版账本升级、账本被清理）、记录与当前产物哈希不符，或构建产物缺失，均属此列。系统 MUST NOT 在缺少证据时假定现存产物为最新。

#### Scenario: 源码未变但产物陈旧
- **WHEN** 某 local package 的源码构建输入哈希与账本记录一致、构建产物目录存在，但磁盘上的产物并非本机上次构建的产出（例如在另一个 checkout 中以相同源码构建、切换分支、rebase，或产物被就地替换）
- **THEN** 系统识别为产物不匹配并重新构建，随后部署的是当前源码的构建结果，MUST NOT 报告 up-to-date 后直接部署陈旧产物

#### Scenario: 产物记录缺失
- **WHEN** 账本中不存在该 package 的产物记录（首次引入本要求后的第一次运行，或账本被清理）
- **THEN** 系统视为无法证明并重新构建，不因缺少该字段而报错或跳过构建

#### Scenario: 产物与源码同代时不重复构建
- **WHEN** 某 local package 的源码构建输入哈希未变，且磁盘产物哈希与产物记录一致
- **THEN** 系统不重新构建该 package，增量构建行为保持不变

#### Scenario: 构建失败不留下被视为可信的产物记录
- **WHEN** 因产物不匹配触发的重新构建失败
- **THEN** 系统报告该 package 失败且不部署，MUST NOT 写入声称构建成功的产物记录，使下一次运行仍会重新构建

### Requirement: 构建新鲜度校验覆盖全部 local package 且保持幂等

系统 SHALL 对 manifest 中每一个 enabled 的 local package 应用同一套构建新鲜度语义；remote package、skill、preset、patch 的既有流程 SHALL 保持不变。本要求 SHALL 位于既有部署副本校验与原子刷新之前，两者语义独立且不互相削弱：前者保证"源目录产物是本机上次构建的产出"，后者保证"部署副本与源目录产物一致"。连续两次运行 `dsh build` 无任何变化 SHALL 仍然成立。

#### Scenario: 校验通过后连续运行幂等
- **WHEN** 所有 local package 的产物均与其产物记录一致且部署副本一致，连续第二次运行 sync
- **THEN** 输出无变化，不触发任何重新构建、隔离或重装动作

#### Scenario: 单个包重建不影响其他包
- **WHEN** 多个 local package 中仅其一的产物与记录不匹配
- **THEN** 只有该 package 被重新构建，其余 package 仍按 up-to-date 处理；该 package 构建失败只影响自身并被报告，不影响其他 package 的处理

### Requirement: 漂移重装前校验部署副本内容
系统 SHALL 在判定 local 包内容漂移并触发重装前,计算部署副本(`<profile>/node_modules/<name>/` 下,package.json `files` 清单与 `dsh.bundle.patch` 对应的完整发布字节)的内容哈希,并与源发布字节哈希比对。哈希一致 SHALL 视为已部署到位、按 up-to-date 处理;不一致 SHALL 进入强制刷新路径。

#### Scenario: 部署副本与源一致
- **WHEN** local 包源内容变化后,部署副本内容与源完全一致(例如先前已人工刷新)
- **THEN** sync 报告 up-to-date,不触发重装

#### Scenario: 部署副本残留旧构建
- **WHEN** local 包源 `lib/` 子树已更新,而部署副本仍保留首次安装的旧文件(pnpm 合并不覆盖的典型结果)
- **THEN** sync 识别为不一致,进入强制刷新,不报告 up-to-date

### Requirement: 强制刷新原子性与失败恢复
系统 SHALL 以"隔离 + 重装 + 校验"刷新部署副本:先把现有部署目录移动到隔离名,再执行 `dsh plugin add`,随后立即复验部署副本哈希。重装成功且复验一致 SHALL 删除隔离目录;重装失败或复验不一致 SHALL 恢复隔离目录为部署目录并报告失败,fail-closed——不得留下缺失或半部署的部署副本。

#### Scenario: 重装成功且复验一致
- **WHEN** 隔离旧副本后重装成功,且部署副本哈希与源一致
- **THEN** 隔离目录被清理,部署到位,后续 sync 报告 up-to-date

#### Scenario: 重装失败恢复旧副本
- **WHEN** 隔离旧副本后重装失败(如 pnpm 报错)
- **THEN** 旧部署副本被恢复,sync 报告失败,不留下缺失部署

#### Scenario: 重装成功但字节仍不一致
- **WHEN** 重装成功但部署副本哈希仍与源不一致(如打包排除规则导致)
- **THEN** 旧副本被恢复(若有),sync 报告失败,不静默接受不一致部署

### Requirement: 校验与刷新覆盖全部 local 包,幂等且不干扰其他流程
系统 SHALL 对 manifest 中每一个 enabled 的 local package 执行同一套校验/刷新语义;remote 包、skill、patch 的既有流程 SHALL 保持不变。连续两次运行 `dsh build` 无任何变化 SHALL 仍成立(刷新后校验一致即 up-to-date)。与既有"修复不完整部署"路径(quarantine)并存 SHALL 互不干扰:两条路径使用不同的隔离命名空间,恢复逻辑各自独立成立。

#### Scenario: 多个 local 包同时漂移
- **WHEN** 多个 local 包源内容都已更新且部署副本均不一致
- **THEN** 每个包独立完成校验与刷新,任一包失败只影响该包并报告,不影响其他包的处理

#### Scenario: 无漂移时幂等
- **WHEN** 所有 local 包部署副本与源一致,连续第二次运行 sync
- **THEN** 输出 no changes,不触发任何隔离/重装/恢复动作
