## Why

`dsh-memex` 的存储内核（`@touchskyer/memex@0.4.1`）是它的**运行前提**，但这个前提只存在于「本机全局 npm root」这一机器/账号本地状态里：它不在 `dsh.yaml` 的物化范围内（`dsh build` 不会装它），不在 `dsh-sync` 的同步清单里，也不在记忆库目录里（库只带卡片与 `.git`）。于是**换机器、换账号、重建 DSH home、恢复记忆库**都会把库带过来、把内核落下，而唯一的恢复办法是人记得 README 里那条 `npm install -g`。

这不是理论风险，2026-10-09 就是现场：整个 `~/.dsh-memex` 于 15:59:39 被拷进本机（全部 381 个 md 的 ctime 完全一致、mtime 保留 = `cp -a`/`rsync -a` 的签名），内核不在本机全局 root 里，于是设置页每个库都显示「远端 不可用 / 详情 missing」（`personal` 明明配着远端也照样显示「不可用」），8 个 memex 工具全部报 `ENOENT … lstat '…/@touchskyer'`——**召回与写卡一起死**，且页面上没有任何一句能说明「该装什么、谁来装」。

## What Changes

- manifest 新增可选字段 `hostPrerequisites`：定制声明自己需要的**本机运行前提**。首版只支持 `kind: npm-global`（`package` + 精确 `version`，可选 `registry`）。
  - 声明放在 manifest 而不是包内：`dsh.yaml` 是「这台机器要跑什么」的唯一入口，且 `enabled: false` / `enabledEnv` 一关就自动停止自愈。
- 新增 `scripts/host-prerequisites.mjs`：只读检查（`--check`）与自愈（默认）两个形态，逐条前提判定「全局 root 下该包存在且版本精确等于声明」，不满足才安装，安装带超时上限与显式 `--registry`。
- `bin/dsh` 在**启动 / 构建 / 重启前**（与 autoUpdate 同一闸口）执行一次自愈：失败只告警、写启动日志，**绝不阻塞启动**；`DSH_SKIP_HOST_PREREQUISITES=1` 为逃生门；新增 `dsh doctor [--check]` 作为手动检查/修复入口。
- `scripts/sync.mjs` 校验 `hostPrerequisites` 的形状（未知 kind、版本范围、重复声明一律拒绝），并把 `enabled`/`enabledEnv` 的判定抽到共享实现，使 sync 与自愈对「这个定制是否启用」只有一个答案。
- `dsh-memex` 设置页在内核不可解析时**说清原因**（需要哪个版本、当前是缺失还是版本不符、下次启动会自愈），不再只把内部失败码 `missing` 原样当事实显示。

## Capabilities

### New Capabilities

- `host-prerequisites`: 定制的本机运行前提如何声明、校验、在启动前自愈，以及失败时如何降级与诊断。

### Modified Capabilities

- `dsh-memex-settings-ui`: 「库的事实经只读端点取得」这条要求增加一条：内核不可解析时页面必须给出可读原因（期望版本 + 缺失/版本不符），MUST NOT 只显示内部错误码。

## Impact

- `dsh.yaml`：`dsh-memex` 条目新增 `hostPrerequisites`，note 补记自愈语义。
- `scripts/sync.mjs`：新增 `hostPrerequisites` 校验；`enabled`/`enabledEnv` 判定改为共享实现（`scripts/lib/manifest-enabled.mjs`）。
- `scripts/host-prerequisites.mjs`（新）、`bin/dsh`（自愈闸口 + `dsh doctor` + usage 文案）。
- `packages/dsh-memex/src/client/{page.tsx,locales.ts}`：内核不可用时的事实文案。
- 文档：`packages/dsh-memex/README.md`（运行前提改为「启动器自动 provision，手动命令仍有效」）、`docs/notes/dsh-memex-integration.md`。
- 测试：`tests/host-prerequisites.test.mjs`（新）、`packages/dsh-memex/test/page.test.tsx`。
- 不改变：存储内核本身、卡片格式、作用域/同步语义、模型面工具集（模型依旧没有任何配置同步或安装类动作）。
