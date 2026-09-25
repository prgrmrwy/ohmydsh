## Why

召回遥测（`2026-09-24-memex-recall-telemetry`）只负责**写**；把 NDJSON 变成「哪些卡是死重量、
空结果率多少」的**读**端，目前是一份放在 `~/.dsh-memex/.eval/recall-report.mjs` 的手工脚本。

这有两个实际问题：

1. **只存在于一台机器上**。遥测按机器落在各自的 `$DSH_HOME/plugins/dsh-memex/`，每台机器都需要
   在本地读，而 `.eval/` 不在任何仓库里、也不随部署分发。在第二台机器上想看报告，只能手动拷脚本。
2. **格式契约分居两处**。记录格式由插件定义（`src/telemetry/record.ts`），读取逻辑却在库外脚本里
   自行假设同一格式，两边改动不会互相约束。已经出过一次这类问题：`hit.scope` 字段新增后，脚本
   对旧记录的处理要另行补丁。

读端与写端同属一个契约，应当随插件一起版本化、测试和分发。

## What Changes

- **新增只读命令 `dsh-memex-recall-report`**，由 dsh-memex 包的 `bin` 声明，随 `dsh build` 在每台机器上
  安装，参数与现行脚本一致：`--days <n>`（默认 14）、`--lib <path>`（默认 personal 库）。
- **报告逻辑移入插件源码并测试**：解析与统计放在 `src/telemetry/report.ts`，与写端共用
  记录类型；命令入口只负责参数与输出。
- **只读且不外发**：命令只读遥测目录与指定库的 `cards/` 文件名，不写任何文件、不发网络请求。
- 库外旧脚本 `~/.dsh-memex/.eval/recall-report.mjs` 不属本仓库，迁移后由使用者自行删除。

## Impact

- `packages/dsh-memex`：新增 `src/telemetry/report.ts`、`src/cli/recall-report.ts` 与测试，`package.json` 增加 `bin`。
- 部署：`dsh build` 后出现 `$DSH_HOME/profiles/<profile>/node_modules/.bin/dsh-memex-recall-report`。
- 无运行时行为变化：Host 进程不加载该命令，检索与遥测写入路径不变。
