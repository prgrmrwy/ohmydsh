## Context

遥测记录格式定义在 `src/telemetry/record.ts`（`RecallRecord` / `HitRecord`），写入位置由
`src/telemetry/sink.ts` 的 `telemetryDir()` 决定。读端当前是库外手工脚本。

## Decisions

### 1. 分发走包的 `bin`，不走 skill 或 Host 工具

- `bin` 是本仓库已有惯例（`dsh-pet-migrate-state`、`dsh-ws`），`dsh build` 后由 npm 在 profile 的
  `node_modules/.bin/` 生成链接，每台机器随部署自动获得，无需额外同步。
- 不做成 memex 工具给 agent 调用：报告是给人看的周期性体检，agent 每轮调用会把统计噪声塞进上下文，
  且「从未召回」本身就需要人判断卡片该删还是该改标题。

### 2. 统计逻辑与 I/O 分离

`report.ts` 导出纯函数：输入记录数组、卡片 slug 列表与时间窗，输出结构化结果；
`cli/recall-report.ts` 负责读目录、解析参数、渲染文本。这样统计口径可以直接用夹具测试，
而不必依赖真实遥测目录。

### 3. 目录解析复用 `telemetryDir()`

读端与写端必须对「遥测在哪」得出同一答案。复用 sink 的 `telemetryDir()`，
避免两处各自拼 `$DSH_HOME/plugins/dsh-memex`。

### 4. 旧记录口径不变，修正一处跨库误判

缺少 `hit.scope` 的记录（写于逐条归属修复之前）计入「已被召回」但不归属任何库，
并在报告中显式给出条数——与现行脚本一致。

现行脚本判定「从未召回」时，用的是**所有库**命中过的 slug 集合：另一个库里同名卡被召回，
会让本库那张被误算成已召回。迁移时收窄为「本库归属的命中 ∪ 未归属的旧记录命中」。
这是有意的口径修正，因此验收 4.3 比对的是**修正后**数字，差异须能逐条解释为同名跨库卡。

库名默认取 `--lib` 路径的末段；scope 名与目录名不同时用 `--scope` 指定。

## Risks

- **`bin` 指向构建产物**：`lib/` 不入库，入口依赖 `dsh build` 生成。这与 `dsh-ws` 相同；
  构建缺失时命令不存在，而不是给出错误报告。
