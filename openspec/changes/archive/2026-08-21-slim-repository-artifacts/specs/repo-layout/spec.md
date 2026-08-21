## ADDED Requirements

### Requirement: TypeScript local package 以源码为版本控制真相源
使用 TypeScript 构建的 `local` package 必须(SHALL)提交源码、构建配置和 package manifest，但不得提交标准构建可重建的 `lib/` JavaScript、declaration 或 source map。其 package exports 与 CLI 可继续指向本地生成的 `lib/`。

#### Scenario: 提交 TypeScript local package
- **WHEN** 开发者完成一个 TypeScript local package 的源码变更
- **THEN** Git 变更包含 `src/` 与必要配置，不包含构建生成的 `lib/` 文件

#### Scenario: 全新 checkout 物化 local package
- **WHEN** 用户按仓库初始化流程安装根依赖后，在没有任何预提交 `lib/` 的全新 checkout 运行 sync
- **THEN** sync 生成该 package 所需的运行产物并成功安装可加载的 package

### Requirement: 仓库依赖锁采用根级单一来源
仓库必须(SHALL)仅提交根 `package-lock.json`，并由该 lockfile 覆盖根工具与仓库内 local package 的开发、构建和测试依赖。`packages/*/package-lock.json` 不得进入版本控制。根 lockfile 必须继续作为 `npm ci` 与 Worktree Session lean dependency cache 的依赖指纹来源。

#### Scenario: 从根安装可复现依赖
- **WHEN** 用户在全新 checkout 根据根 `package-lock.json` 执行仓库初始化或 `npm ci`
- **THEN** 根工具和所有纳入管理的 local package 获得完成构建与测试所需的锁定依赖

#### Scenario: local package 依赖发生变化
- **WHEN** 开发者修改 local package 的 dependency 或 devDependency
- **THEN** 仅根 `package-lock.json` 随之更新，package 目录中不产生需提交的独立 lockfile

### Requirement: 长期仓库仅保存必要且可维护的派生资产
仓库必须(SHALL)忽略可重建构建输出、OpenSpec checking 的 raw session/history baseline 与批量截图，以及同一架构图的重复重量级导出。长期保留的 checking 内容必须是轻量报告、trail、gate 或复现脚本；仓库架构图必须保留一种可直接展示的轻量格式与其可编辑真相源。若原始验收证据仍需审计，报告必须指向 Git 之外的 artifact 位置或说明其留存方式。

#### Scenario: 完成 OpenSpec 验收
- **WHEN** 验收产生 raw JSON、会话历史和一组截图
- **THEN** Git 仅保留可复核的轻量摘要与复现信息，raw evidence 不进入版本控制

#### Scenario: 更新仓库架构图
- **WHEN** 架构变化需要重新生成图形
- **THEN** 开发者更新可编辑图源和唯一的仓库展示格式，不提交同图的 PNG、SVG 与交互 HTML 多套重复导出

## MODIFIED Requirements

### Requirement: sync 按来源分发物化
sync 必须(SHALL)按 `source` 分发物化动作：`local` 在安装前根据源码和构建输入生成或复用当前 checkout 的运行产物，再用仓库路径安装；`remote` 用其 `spec` 从原址安装。local 构建失败时必须在替换已部署 package 前报错停止，不得安装缺失或陈旧的 checkout 产物；两种来源必须共享相同的开关、幂等与生成标记语义。

#### Scenario: 混合清单一次 sync
- **WHEN** manifest 同时包含已启用的 `local` 与 `remote` 条目，且 local package 构建依赖已由根安装准备
- **THEN** 一次 sync 运行生成必要的 local 运行产物，并使两类定制全部就位

#### Scenario: 未变源码重复 sync
- **WHEN** local package 的源码、构建配置和依赖均未变化，且运行产物存在并与构建输入匹配
- **THEN** 后续 sync 复用该运行产物，部署面不发生变化

#### Scenario: local 构建失败
- **WHEN** 已启用 local package 的运行产物缺失或过期，且其构建命令失败
- **THEN** sync 以明确错误退出，并保留此前已部署的可用 package，不执行该 package 的 remove/reinstall

#### Scenario: remote 版本 pin 复现
- **WHEN** 同一 manifest 在全新环境运行 sync
- **THEN** 安装的 `remote` 定制版本与 manifest 中的 pin 一致
