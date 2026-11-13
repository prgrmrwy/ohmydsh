## Context

`localBuildInputHash(dir, extraInputs, root)` 已对包自身源码及 `buildInputs` 文件计算哈希；`requiredSourcesOf`/`preflightSources` 在任何 profile 写入前校验文件与所属根。`collectFiles` 已递归收集普通文件，默认跳过点号条目、node_modules 和内部符号链接。

后续 dsh-collab 会在构建时内联独立 collab-kernel。它需要跟踪内核源码目录中的新增/删除文件，而不是维护逐文件清单。本 change 只阻塞该消费者的集成/部署，不阻塞内核独立开发。

## Goals / Non-Goals

**Goals:** 接受目录 buildInputs，复用现有遍历规则，保持旧文件条目的哈希和预检行为。

**Non-Goals:** 新的过滤选项、glob、跨包依赖图、自动构建库的拓扑排序、改变 package 自身输入规则。

## Decisions

### D1. 按实际类型扩展现有预检

`requiredSourcesOf` 为 buildInputs 返回 `file-or-dir`；`preflightSources` 显式检查 `isFile() || isDirectory()`，其他类型拒绝，文案为 `must be a regular file or directory`。原 file/dir 两种严格检查保留。路径 realpath 必须在所属根内；不新增 manifest kind 字段或 buildInputDirs 列表。

### D2. 复用 collectFiles 默认行为，不添加排除机制

目录分支直接使用 `collectFiles(absolute)`，不传新的过滤规则。收集该目录下所有普通文件；既有默认行为仍跳过名称以 `.` 开头的条目与 node_modules，不跟随目录内部文件/目录符号链接。`src/lib/core.ts`、`src/test/helper.ts` 都正常计入，无源码目录命名禁区。

消费者选择输入范围，而不是让 sync 猜测哪些目录是产物。例如 dsh-collab 声明 `packages/collab-kernel/src`、内核 `package.json` 和实际使用的 tsconfig/打包配置文件；不声明整个包目录，因此包外的测试、README 和 lib 变化不因这个源码条目触发重建。新增源码文件无需修改清单。依赖已存在的配置文件清单是显式构建边界，不承诺自动追踪任意新配置、外部文件或符号链接目标。

消费者的构建必须直接解析当前内核源码，或在自己的 build 中先构建内核；不能只监测 src 然后从陈旧 lib 打包。该接线及干净 checkout 打包验收属于 dsh-collab，不为此扩展 sync 的构建调度。

*备选：按名递归排除 lib/test 等目录。* 删除。它增加规则和 collector 选项，却会漏掉 src/lib 下的真实源码。

### D3. 文件编码不变，目录加类型前缀

旧文件分支保持 `repo:<原条目路径>\0` + 内容；包自身 collector 默认选项、选择与编码全部不变。目录分支写入 `repo-dir:<条目路径>\0`，再按所属根相对路径排序，逐文件加入 `<相对路径>\0` + 内容。空目录仍有前缀贡献；条目按原路径字符串排序、重复和重叠逐项贡献，不去重。

忽略内容只不改变该目录条目的贡献，不取消其他显式输入和独立产物新鲜度规则。无变化、不重建的验收须同时保证其他输入、产物记录和部署副本一致。

### D4. 验收保留真实边界，不新增测试框架

复用 Node 原生测试、现有 overlay/freshness fixture 与隔离 DSH_HOME：
- file/dir 接受；FIFO/socket 写入前拒绝；原 file/dir 错型检查保持严格。
- 源码修改、新增、删除、改名改变哈希；嵌套 lib/test 源码计入；空目录稳定且区别于无输入，条目排序不影响结果。
- 源码目录之外的 test/lib 不影响该条目；目录内点号/node_modules/内部符号链接按既有规则忽略。链接测试放在可遍历目录内；顶层目录链接根内接受、根外拒绝。
- 文件/目录重叠、重复及自身目录不去重；自身产物漂移、记录缺失仍触发独立新鲜度重建。
- 公开/外部 overlay 同名目录各读所属根；同 Node 版本、同 fixture 用冻结旧算法验证纯文件输入哈希兼容。
- 构建 fixture 直接消费外部源文件，验证变化后的发布字节、连续第二次 sync 幂等；不只验证账本哈希。

## Risks / Trade-offs

- [把整个包当目录输入会收录测试和构建产物] → 消费者声明 src 目录及必要配置文件；sync 不增加自动排除策略。
- [默认 collector 不跟随内部链接，也忽略点号条目] → 与已有工具一致；需要这些输入时另声明明确的文件/目录条目，并受原有 realpath 围栏约束。
- [外部输入变化时构建仍消费旧 lib] → 消费者必须在 build 中接通当前源码；首次接入以干净 checkout 验证。

## Migration Plan

文件条目无需迁移。新增目录条目只由后续消费者显式启用；本 change 不改日常部署。回滚实现后，使用目录条目的消费者须先撤回这些条目。

## Open Questions

无。
