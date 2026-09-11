# Pet Locus 固定源码兼容运行时

## 这是什么

当前 `dsh.yaml` 固定 DSH `0.1.2-rc.1`，但 Pet unified locus 还需要该正式包
尚未发布的两组宿主能力：

- continuable child 可选择 `settlementNotice: silent`，且能创建 idle child、在
  continuation owner 内访问准确 child Session；
- Storage/Domain/SQLite/JSON 的原子 batch/transaction，其中 SQLite 可取得介质
  独占所有权。

本目录保存固定 upstream tag、可审查 patch/hash 与可重建脚本。生成的
`.upstream/`、`.storage-upstream/`、`storage-artifacts/`、`lib/`、`.launcher/`
均不是部署真相，不进入 Git。

## 声明式选择与作用域

`dsh.yaml` 的本地 `dsh-pet` customization 声明：

```yaml
hostRuntimeCompatibility:
  kind: pet-unified-locus-v1
  supportedDshVersion: 0.1.2-rc.1
```

该声明表达“Pet 请求 Host 级兼容运行时”，技术效果是整个长期 `dsh web` Host
使用隔离 DSH 依赖根；它不是只影响 Pet 插件内部的局部替换。

只有 `scripts/dsh-server-bin.mjs` 解析此声明。`dsh build`、sync、plugin、
`--dump-config` 等一次性命令在没有人类显式 `DSH_BIN` 时仍使用 `dshVersion`
指定的官方精确 CLI，不构建、不加载该 overlay。`DSH_BIN` 仍是跨命令紧急逃生门，
不再是 Pet 的正常持久配置。

旧机器若 `.env.local` 仍含当前 checkout 的历史 Pet launcher 路径，`bin/dsh`
会识别由该文件新注入的精确值、打印迁移告警并忽略；调用方在 shell 中显式设置
同一路径时仍优先，其他路径绝不猜测或删除。

## 构建与安全边界

Host 首次准备会执行 `build-launcher.cjs`；fingerprint 命中时只做轻量自证，
不 clone、build、install 或访问 registry。fingerprint 覆盖：

- 固定 DSH 版本与 checkout canonical path；
- 两份 patch 及其固定 SHA；
- Subagent/Storage/launcher/lock/timeout builders；
- package template。

重建时使用一把跨进程、可恢复 stale owner 的共享锁，覆盖 Subagent 源码、Storage
artifacts 与 launcher 整条链，并固定 `npm@11.19.0`（launcher）及上游声明的 `pnpm@11.7.0`（源码构建），以消除机器全局包管理器漂移。源码 checkout 仅在 install 子进程设置 `CI=true` 跳过无关的开发仓库 Lefthook 安装，依赖自身 install scripts 仍执行；tsc/tsdown 构建不继承该环境。reviewed DSH 源码要求 Node `^22.19.0 || >=24.0.0`，旧 Node 会在 clone/install 前明确失败。所有外部 git/corepack/npm 子进程通过有界 supervisor
运行，超时会终止进程组。launcher 在同文件系统 sibling staging 中完成：

1. 固定 tag 构建并验证 patch capability marker；
2. 安装官方 `@deepseek-ai/dsh@0.1.2-rc.1` 与五个 reviewed overrides；
3. 显式审批固定 install scripts；
4. 验证依赖树唯一性、package identity/version/provenance、实际能力与 DSH
   `--version`；
5. 把 file links 转为自包含 package copies，再原子发布。

任一步失败都不会删除已有 `.launcher`；本次 Host 启动 fail closed，不静默回退
官方 runtime。启动控制台和 `dsh-startup.log` 会记录 runtime kind、owner、compat
kind 与版本。

## 版本升级与移除

`supportedDshVersion` 必须精确等于 `dshVersion`。sync 在任何 profile 副作用前
校验，plain Host start 也独立复核。自动升级只改官方 pin，故新版本会有意触发
mismatch、sync rollback 和停止启动；绝不会自动把旧 patch 套到未知新源码。

升级前必须重新审查 upstream：

1. 若官方已发布全部能力，删除 `hostRuntimeCompatibility` 和本目录相关 overlay；
2. 否则针对新固定 tag 重新推导 patch、hash、能力验证与 compatibility kind/version。

不要仅修改版本字符串让构建继续。
