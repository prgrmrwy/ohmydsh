## Why

`collab-kernel` 是一个独立的本地库包，由后续的 `dsh-collab` 插件在构建时内联进自己的产物（tsdown `noExternal`）。sync 判断 local package 是否需要重建时，只看该包自己目录下的 `src/`、`package.json` 和构建配置，再加上 `buildInputs` 列出的文件。所以改了内核之后，`dsh-collab` 不会被重新构建，部署上去的仍是旧内核。

`buildInputs` 目前只接受**文件**。要覆盖内核，就得把它的每个源文件逐个列进 `dsh.yaml`，新增或删除文件时还要同步修改。这正是用户要求"开工前别留尾巴"的那类尾巴。

## What Changes

- `buildInputs` 的条目可以是**目录**。直接复用现有 `collectFiles` 默认遍历，不添加过滤选项：收录普通文件，保持跳过点号条目、node_modules 和内部符号链接的原有行为，嵌套 `lib`、`test` 源码也会收录。消费者声明内核 `src/` 目录及实际使用的包/构建配置文件，不把整个包目录交给自动黑名单猜测。
- 目录与文件条目共用同一套越界与预检约束：解析符号链接后必须位于条目所属根内；预检时必须存在。不另声明类型，按磁盘实际类型接受普通文件或目录；其他类型报错。
- 哈希对路径和类型敏感：目录内每个文件按"所属根下的相对路径 + 内容"计入。文件被增删或改名都会改变哈希；同一个文件既以文件条目、又经目录条目被覆盖时，结果是确定的。
- 已有的文件条目行为不变，现有部署的哈希也不会因本 change 变化（文件条目的哈希编码保持原样）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `repo-layout`：在「本地 manifest overlay 追加不可公开定制」中，越界约束与源码预检对 `buildInputs` 的表述从"每个 `buildInputs` 文件"扩展为"每个 `buildInputs` 文件或目录"，并新增构建输入目录的语义与场景。

## Impact

- `scripts/sync.mjs`：`localBuildInputHash` 增加目录分支；预检中 `requiredSourcesOf` 的 package 分支为 `buildInputs` 产出 `kind: 'file-or-dir'`，`preflightSources` 增加该分支及对应错误文案，原有的 `file`、`dir` 严格检查保持不变。
- `tests/`：新增目录条目的哈希触发、越界、缺失与类型不符的用例；现有 `buildInputs` 用例保持通过。
- 不改变 manifest 字段名，也不影响 remote package、skill、preset、patch。本能力是后续 `dsh-collab` 集成/部署前置，不阻塞 `collab-kernel` 独立开发。
