## Why

在一台没有 `~/.dsh` 的机器上(devbox `n37-044-026`)按 README 流程执行 `dsh build && dsh`,sync 以失败收场:

```
[sync] ERROR profile package.json missing at /home/zhangyong.617/.dsh/profiles/web
[sync] finished with 1 failure(s):
  - profile package.json missing at /home/zhangyong.617/.dsh/profiles/web
```

`syncPackages()` 与 `doReset()` 都以 `$DSH_HOME/profiles/<profile>/package.json` 存在为前置,但没有任何步骤负责创建它。运行体确实会在加载 profile 时按模板 `initProfile`,可那发生在 DSH **启动**时;而 `dsh build` 是启动之前的物化步骤。于是全新机器上二者互为前提:sync 要装的包需要 profile manifest,而 profile manifest 要等 DSH 启动才出现。sync 一直隐式依赖"这台机器此前跑过 DSH",这个假设在既有机器上恒真,在全新机器上恒假 —— 因此该缺陷只在首次部署时暴露。

真正的危害不是这一行报错,而是它的次生后果:`syncPackages()` 用 `return fail(...)` 提前返回,**全部 package 类定制被整体跳过**。sync 仍继续物化 skills 和 patch 层并打印 `dshVersion`,输出看上去大体正常;随后 DSH 以只有出厂 bundle 的 profile 启动,manifest 里声明的 13 个 bundle 一个都没装。用户看到的是"插件莫名其妙全都没了",而不是"部署未完成"。

## What Changes

- sync 在读取任何 profile 状态之前显式物化 profile 骨架:manifest 缺失时,以目标版本 CLI 的 `--profile <name> --dump-default-config` 触发运行体自身的 `initProfile`,再继续原有流程。
- 骨架的真相源保持在运行体(`@deepseek-ai/dsh-app-boot` 的 `PROFILE_TEMPLATES` / `initProfile`),本仓库**不**复制一份 profile 模板 —— 否则模板会与运行体各自演进,`dshVersion` 升级后悄悄产生偏差。
- 该步骤幂等:manifest 已存在时直接返回,不触碰任何既有文件,也不调用 CLI。
- 该步骤 fail closed:骨架无法物化时报错,使首因可见,而不是把它变成随后一连串"package 装不上"的次生失败。
- `runDshCli` 增加 `stdio` 透传,使把 CLI 当作副作用执行时可丢弃其 stdout(此处输出是整棵默认配置树,对 sync 日志无意义)。

不在范围内:`syncPackages()` 在其他前置失败时的既有 fail 语义、profile 骨架之外的任何部署内容,以及 `bin/dsh` 的启动路径。

## Capabilities

### New Capabilities

无。这是补齐既有能力("sync 幂等地物化启用定制")在全新环境下缺失的前置。

### Modified Capabilities

- `repo-layout`:新增要求 —— sync 必须在物化 package 定制前确保目标 profile 骨架存在,骨架内容以运行体模板为真相源,且该步骤幂等、fail closed。

## Impact

- 代码:`scripts/sync.mjs`(新增 `ensureProfileScaffold()` 并在 `main()` 中前置调用)、`scripts/lib/dsh-cli.mjs`(`stdio` 透传)。
- 测试:新增 `tests/sync-profile-scaffold.test.mjs`,覆盖全新 home、既有骨架、`--reset` 与骨架物化失败四条路径。
- 行为:全新机器上 `dsh build` 一次跑通;既有机器上骨架已存在,该步骤为空操作,输出与此前逐字相同。
- 风险:低。新增路径只在 manifest 缺失时触发,而此前该状态必然失败;既有部署面不受影响。
