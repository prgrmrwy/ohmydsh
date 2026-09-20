## Context

Pet 的媒体下载当前依赖一份**私有 fork**：`packages/dsh-pet/compat/lark-cli/` 在冷构建时 clone `larksuite/cli` 到固定 commit `f065bf5`、下载四平台固定 Go 1.23.12 工具链并编译，再对 `im +messages-resources-download` 打 `bounded-fd-download.patch` 增加隐藏的 `--output-fd` / `--max-bytes`。磁盘代价约 430 MB（`.upstream` 44 MB + `.toolchains` 342 MB + `artifact` 43 MB，全部 gitignore），另需长期承担 patch 与上游 pin 维护（`dsh.yaml` 的 `buildInputs` 显式登记这三个文件）。

它换来的独占能力只有一条：**媒体字节不存在于任何具名路径**。但本仓已经实测/核实的事实削弱了这条能力的边际价值：

- 图片必然持久化到 `$DSH_HOME/attachments`（content-addressed，规范要求），而这份持久副本的唯一保护是 Locus child 的 project-read guard（`src/index.ts:1112` 的 `deniedRoots` 指向 `dshHome` / `stateRoot` / `dshHome/attachments`）。
- 官方 `lark-cli` 1.0.94 的 `--output` 允许根是 **cwd / /tmp / ~/files**（`compat/lark-cli/.upstream`：`internal/vfs/localfileio/path.go:46`，cwd 取自 `vfs.Getwd()`，`:162`）；内置 denylist 是 `/etc /proc /sys /dev /root /var/run` 加一批 home 凭据名与 `~/.lark-cli`（`policy.go:212-260`）。**`$DSH_HOME` 既在允许根之外不受保护、也不在 denylist 内**，但它已经在 child 的 `deniedRoots` 里。
- 其余调用早就按 PATH 解析 `lark-cli`（`src/host/channel/lark.ts:539,931`），"绝不回退 PATH" 只是媒体这条路径为区分 patched/unpatched 二进制才需要的约束。

约束：`pet-locus-media-access` 的单图 / 消息双层限额、attachment 持久化、typed image 注入、current 三处重验与 fail-soft 降级语义都不得改变；媒体不可用时文字 Delivery 必须继续。

## Goals / Non-Goals

**Goals:**

- 删除 `compat/lark-cli` fork 与其构建链，冷构建不再 clone 上游、不再下载 Go 工具链、不再编译。
- 用官方 CLI 在**受守卫的私有目录**内完成下载，保持"child 读不到媒体字节"这一可判定属性。
- 下载有界：写入期超限立即终止；成功、失败、取消、超时、崩溃一律不留下产物。
- 媒体可用性判定仍是确定性的、fail-soft 的：不满足前置时 media port 保持 unavailable，文字 Delivery 继续。

**Non-Goals:**

- 不改 `lark-cli` 本身，不替换或覆盖用户全局 CLI，不改 `dsh.yaml` 中的 lark-cli pin 与 profile（`dsh-pet`）。
- 不改 attachment 持久化、typed image 注入、模型 fallback、双层限额与 current 重验语义。
- 不追求"字节永不落盘"（见 Decisions 1）；不引入新的常驻守护进程。
- 不把 `--output-fd` / `--output -` 提上游（见 Open Questions）。

## Decisions

### 1. seam 改为官方 CLI 路径模式，落盘位置由 Pet 的 spawn cwd 决定

Host 在 Pet 私有 spool 下为每次调用创建一个独占子目录（`<spool>/<32-hex>`，0700），以该子目录为 `cwd` spawn 官方 `lark-cli`，用相对 `--output ./<32-hex>.bin` 落盘。cwd 是 CLI 内置允许根之一，因此不需要任何 patch；而该目录由 Pet 选择，因此"写在哪里"完全由 Host 决定。

子目录而不是共享目录下的文件名，是因为官方保存是原子的（temp + rename），而 CLI 不承诺那个临时文件叫什么名字；只有整目录归本次调用所有，"删掉本次产生的一切"才是可证明的。

备选与否决理由：

- **保留 fork（现状）**：拒绝。保护的是"网络 → Host 内存"这一跳，而持久副本本身只由读取守卫保护；用 430 MB 与持续 patch 维护换一跳不成立。
- **`--output` 写到 `/tmp`**：拒绝。`/tmp` 是 CLI 允许根，但它是全机共享路径，child 读取守卫无法把它整体拒掉；这正是原规范点名禁止 `/tmp` 的原因，本次不放开。
- **写 FIFO 制造"有名无字节"**：拒绝。官方 `FileIO().Save` 是原子写（`localfileio.go:74-86` 的 `AtomicWriteFromReader`，temp + `rename`），会把 FIFO 替换成普通文件。
- **把 `/dev/fd/3` 当 `--output` 传**：拒绝。`/dev` 在 CLI 内置 denylist（`policy.go:213`），且相对路径会被 `checkRelativeStaysInCwd` 拒。
- **提上游加通用 `--output -`**：方向更优但依赖上游排期，不作为本 change 的前置；见 Open Questions。

### 2. spool 目录放在 Pet state root 之下，复用既有守卫覆盖

`paths.stateRoot`（`$DSH_HOME/plugins/dsh-pet/`）下新增 `media-spool`，权限 0700。它已经在 `deniedRoots` 之内（`src/index.ts:1112`），因此**不需要改守卫代码**；但必须新增一条回归测试，证明 safe child 的 `read` / `read_image` / `glob` / `grep` 都拿不到其中任何文件——本 change 之后守卫是该属性的**唯一**依据（推翻归档 design 中"不再作为媒体隔离依据"的决定）。

### 3. 有界策略：写入期轮询终止 + 既有第二层累计

- 每次下载把本次允许的上限写死为 `min(maxImageBytes, maxMessageImageBytes - 已累计)`，与现状一致（`src/host/channel/media.ts:292`）。
- spawn 后每 **50 ms** `statSync` 目标文件（含原子写临时文件，取同前缀条目里的最大值）；一旦超过上限立即 `killProcessTree` 并删除全部同前缀条目。
- 检测延迟上限 ≈ 50 ms × 本地磁盘写入速率。spool 在本地盘、且上限本身来自 DSH 部署的单图限额，因此最坏多写量有界且远小于一个磁盘风险量级；不引入 inotify/fsevents（跨平台差异与依赖不值得）。
- 下载完成后仍按文件实际尺寸做尺寸校验与累计（沿用现有 `totalBytes` 逻辑），CLI 退出码与 stdout receipt 仍按现状校验。
- **明确接受的退化**：已知 `Content-Length` 的**读前**拒绝不再可用（官方 CLI 路径模式没有任何字节上限）。补偿为写入期终止、下载后校验与无条件删除；该退化已写进 delta spec 的 REMOVED **Migration**。

### 4. 清理：调用内删除 + 启动清扫

- 每次调用在 `finally` 中递归删除本次的独占子目录（无论成功、非零退出、Abort、timeout、进程错误）。递归而非按名匹配，是为了连 CLI 用任意名字创建的原子写临时文件一起删掉。
- Pet 初始化时清空 spool 根下的全部条目：此刻不存在在飞下载，因此"目录内任何东西"都是上一轮崩溃残留。
- 并发下载各自拥有子目录，互不干扰；不做基于时间的 TTL（多一个可失效的判据，收益不明确）。

### 5. 可用性判定：官方 binary 可解析 + 版本 pin 一致

`resolvePetLarkCliCompat` 的语义由"包内 artifact + provenance.json + binary sha256"改为"`lark-cli` 可解析为可执行文件，且 `lark-cli --version` 报告的版本等于 pin `1.0.94`"；两者任一不满足即抛 `PetLarkCliCompatUnavailableError`，由 `src/index.ts:346-350` 现有的 try/catch 降级为纯文本（日志一条、不致命）。

保留版本门的原因：路径模式的允许根、denylist 与 `--output` 语义是实现契约，跨版本可能变化；版本不符时宁可不下载，也不要在未知语义下写盘。

## Risks / Trade-offs

- [轮询窗口内已写入的超限字节] → spool 在本地盘，最坏多写 ≈ 50 ms × 写入速率；上限来自 DSH 单图限额，且文件随后必删。
- [隔离从"物理无路径"退化为"依赖读取守卫"] → 新增 child 无法读取 spool 的回归测试；守卫本身在根不可证时会 veto child publication（`src/host/locus/project-read-guard.ts:48,54`），不会 fail-open。
- [CLI 未来版本改动允许根或 denylist] → 版本门 + 失败 fail-soft（不下载、不写盘）。
- [崩溃残留被误当作输入] → 残留只可能出现在 spool，且每次调用只读自己刚生成的目标名；启动清扫后目录为空。
- [删除失败（权限/占用）] → 删除失败只记诊断，不阻断 Delivery；残留由下次启动清扫兜底，且始终位于 child 被拒 root 内。

## Migration Plan

1. 先加 spool 路径常量、清理函数与"child 无法读取 spool"回归测试（红）。
2. 改写 `src/host/channel/media.ts` 的下载实现：路径模式 spawn、轮询终止、`finally` 清理。
3. 改写 `src/host/channel/lark-cli-compat.ts` 的判定（可解析 + 版本 pin），`src/index.ts` 的 wiring 与启动清扫。
4. 删除 `packages/dsh-pet/compat/lark-cli/`、`package.json` 中 `build:runtime-compat` 的 lark-cli 段、`dsh.yaml` 的 `buildInputs` 三条登记。
5. `npm run build`、`npm run typecheck`、`npm test`、`node scripts/sync.mjs` 连续两次幂等。
6. 真机验收：群内发图 → child 收到 typed image；结算后 spool 为空；让 child 尝试读取 spool 被拒；拔掉 `lark-cli` 后媒体降级为纯文本且 Delivery 继续。
7. 回滚：`git revert` 恢复 compat 目录与构建链即可回到 fd 模式；本次不产生数据迁移，无 schema 变更。

## Open Questions

- 是否把"二进制出口"作为**通用**能力提上游（`--output -` 写 stdout，上游已有 `-` 约定可用于 stdin 侧）？合并后 spool 落盘可整体去掉，`compat/lark-cli` 亦可从"编译 fork"退化为"下载固定 release"。本 change 不阻塞该路径，也不为其预留抽象。
- spool 是否需要按 Delivery 分目录（便于并发可观测）？当前实现按随机文件名区分即可，若出现并发诊断困难再引入。
