# sync-local-deploy-refresh Specification

## Purpose

`dsh build` 物化 local 包时,保证部署副本(node_modules 下)的发布字节与源目录发布字节一致;不一致时自动"隔离旧副本 + 重装 + 失败恢复",消除 pnpm `file:` 目录依赖合并不覆盖导致的"构建产物从未上线"问题。

## ADDED Requirements

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