# Pet Locus Host runtime compatibility：声明式部署

原阻塞是 pinned DSH `0.1.2-rc.1` 尚未发布 silent child settlement 与 Pet Locus
所需原子 Storage 能力。固定源码补丁仍保留，但部署已从每台机器手写
`.env.local DSH_BIN` 收敛为 `dsh-pet` 自身声明。

## 当前方案

```yaml
# dsh.yaml / customizations[dsh-pet]
hostRuntimeCompatibility:
  kind: pet-unified-locus-v1
  supportedDshVersion: 0.1.2-rc.1
```

- compatibility 属于 Pet 的部署需求，但技术 override 是长期 Web Host 进程级；
- 仅 `dsh web` Host 使用隔离 launcher；
- build、sync、plugin、dump-config 无显式覆盖时始终使用官方精确 CLI；
- 普通人类显式 `DSH_BIN` 仍是全命令紧急逃生门；
- 旧 `.env.local` Pet launcher 值由 `bin/dsh` 精确识别并迁移忽略，无需逐机先改
  配置才能安全 build；调用方显式同值不忽略。

## 生成与验证

固定 kind 由代码映射到 Pet 包内 builder 与真实 DSH `lib/bin.js`，manifest 不能指定
任意可执行路径。builder 使用共享跨进程锁、外部命令总超时、sibling staging 与
原子发布；新构建失败保留旧成品，本次启动 fail closed。

fingerprint 包含版本、patch/builders/template 及 checkout canonical path。命中时只做
轻量 capability/provenance/install-script 自证；缺失、破损、仓库移动或输入变化才
重建。发布前验证 Subagent 三个 capability marker、四个 Storage package provenance、
运行依赖树唯一性、安装脚本已审批及 `--version` 精确匹配。

## 版本 fence

sync 在任何 profile 副作用前、Host plain start 在运行前都要求
`supportedDshVersion === dshVersion`。自动升级故意不改 compatibility pin；mismatch
触发现有 sync 失败与完整 manifest rollback，不自动把旧补丁套到新 DSH。

官方发布能力后，先审查并删除声明/overlay，再升级；若仍需补丁，则针对新固定 tag
重新推导 patch、hash、验证和 compatibility kind/version。

## 既有能力证据

- Subagent upstream：31 文件 / 778 测试；实际 runtime marker 和 silent 分支验证；
- Storage upstream：原子 batch/transaction 与 SQLite exclusive 的范围测试；
- 隔离 launcher：官方 DSH 主包 + reviewed transitive overrides，无双副本；
- npm 固定 install scripts 显式审批；
- server-bin 返回真实 `node_modules/@deepseek-ai/dsh/lib/bin.js`，不返回 `.bin` shim。

现有 GUI 是否已使用新 runtime 只由下一次人类执行的正常 restart 决定；本次部署不
擅自重启 Host。
