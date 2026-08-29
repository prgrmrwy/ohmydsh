# Changelog

本文件记录 ohmydsh 仓库级的显著变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> **范围说明**
> 本文件只记录**仓库级**变更(启动器、sync、仓库约定、工程化)。
> - 自研 package 各自维护独立 CHANGELOG,见 `packages/<id>/CHANGELOG.md`;
> - 第三方插件的版本 pin 与审查记录见 `dsh.yaml` 各条目的 `note`;
> - 完整的设计动机与验收记录见 `openspec/changes/`(进行中)与 `openspec/changes/archive/`(已完成)。
>
> 本仓库尚未发布带 tag 的版本,所有变更暂归入 Unreleased。

## [Unreleased]

### Added

- 开源社区标准文档:`LICENSE`(MIT)、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、本 CHANGELOG。
- GitHub 协作配置:CI 工作流、Issue / PR 模板、Dependabot 依赖更新。
- `README.en.md` 英文说明,以及 `.editorconfig` 统一编辑器风格。
- 启动器 npm 环境作用域收窄的规范与回归测试(`openspec/specs/launcher-npm-environment`)。
- 全新机器上的 profile 骨架自动物化,避免首次部署因缺失骨架失败。
- 部署面完整性核验:sync 按 manifest 承诺校验并自愈残缺 package。
- Worktree Session `ws clean` 支持主仓会话的仓库级清理。

### Changed

- 启动器不再向进程树注入 npm 环境,server 改由 node 直连拉起。

### Fixed

- 修复重复打开浏览器标签页的问题。
- 官方 CLI 命令直通,修复 `unknown option '--profile'` 导致的启动失败。
- 检测远程 tarball pin 漂移,避免 fork-patch 更新永不部署。

[Unreleased]: https://github.com/prgrmrwy/ohmydsh/commits/main
