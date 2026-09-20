## Why

Pet 现在为了媒体下载维护一份**私有 fork**：`compat/lark-cli/` 在每次冷构建时 clone `larksuite/cli` 固定 commit、下载固定 Go 1.23.12 工具链并编译，磁盘代价约 430 MB（`.upstream` 44 MB + `.toolchains` 342 MB + `artifact` 43 MB），并要长期承担 patch 与上游 pin 的维护。它换来的独占能力只有一条——"字节不存在于任何具名路径"。

但这条能力的边际价值比当初设想的小：图片最终**无论如何**都会持久化到 `~/.dsh/attachments`（规范要求如此），而那份持久副本只由 Locus child 的项目读取守卫保护。也就是说守卫早就是承重层；fd seam 额外保护的只是"网络 → Host 内存"这一跳。用一份 430 MB 的 fork 只保护一跳，性价比不成立。

官方 `lark-cli` 1.0.94 的路径模式已经足够构成受控下载：`--output` 的允许根包含 **cwd**，而 spawn 的 cwd 由 Pet 决定；`~/.dsh` 既不在 CLI 内置 denylist 里，又已经在 child 的 `deniedRoots` 里。于是"写到一个 child 读不到的目录"可以用官方二进制直接做到，不需要 patch。

## What Changes

- **BREAKING（构建面）**：删除 `compat/lark-cli/`（patch、固定 Go 工具链、provenance 构建脚本与 artifact），`build:runtime-compat` 不再包含它；冷构建不再 clone 上游、不再编译 Go，日常 `npm run build` 少一个约 430 MB 的目录树。
- 媒体下载改为**官方 `lark-cli` 路径模式 + Pet 私有目录**：Host 以 `cwd = <Pet 私有 0700 目录>`（位于 `~/.dsh` 之下）spawn CLI，用相对 `--output ./<random>.bin` 落盘；该目录必须被 Locus child 的项目读取守卫拒绝。
- 下载生命周期由 Pet 自己承担：轮询目标文件增长，超过本次 Delivery 的字节上限立即终止整个进程组；成功、失败、取消、超时一律在同一次调用内删除目标文件与原子写的临时文件；进程启动时清扫上一轮崩溃残留。
- 媒体可用性判定从"私有 artifact provenance"改为"官方 binary 可解析且版本受 pin"，缺失或版本不符时 media port 保持 unavailable，文字 Delivery 继续（fail-soft 语义不变）。
- 规范条款改写：把"图片 bytes MUST NOT 进入 stdout/stderr、项目目录、`/tmp` 或 Pet state"改为可判定的**目的条款**——字节只允许存在于 Locus child 读取守卫拒绝的 root 内，且在 Delivery 结算前删除；**明确接受**"已知 Content-Length 读前拒绝"这一能力丢失，并给出补偿（下载后校验 + 写入期硬终止 + 永久删除）。
- 归档 design 中"project-read guard 不再作为媒体匿名 pipe 的隔离依据"的决定**被本 change 推翻**：从现在起守卫是该属性的唯一依据，因此必须新增一条回归测试钉住"私有目录确实被 child 守卫拒绝"。
- 本 change 不改动 `lark-cli` 本身，不改动全局 CLI，不改动 attachment 持久化、typed image 注入、双层限额与 current 重验语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-media-access`: 媒体下载的取得 seam 由"私有固定源码 fork 的 inherited-fd"改为"官方 CLI 的受守卫私有目录路径模式"；新增"私有目录必须位于 child 被拒 root 内"、"下载期有界终止"与"结算前删除"三条可判定要求，并删除只能在 fd 模式下成立的 stdout/stderr 条款。

## Impact

- Pet Host：`src/host/channel/media.ts`（下载与生命周期）、`src/host/channel/lark-cli-compat.ts`（由 provenance 校验改为官方 binary 解析与版本 pin 校验）、`src/index.ts`（媒体可用性 wiring 与 `deniedRoots`）、`src/host/paths.ts`（新增私有媒体目录）。
- 删除：`packages/dsh-pet/compat/lark-cli/`（含 `build.mjs`、`bounded-fd-download.patch`、`README.md`）、`package.json` 的 `build:runtime-compat` 中的 lark-cli 段落。
- 测试：新增"私有目录被 child 守卫拒绝"回归；改写媒体下载单测为路径模式（有界终止、取消/超时清理、崩溃残留清扫）；保留既有 attachment/admission/current 重验用例不动。
- 文档：`docs/notes/` 记录本次 seam 更换的取舍与被接受的退化；`openspec/specs/pet-locus-media-access/spec.md` 为唯一受影响的 current spec。
- 部署：需要重新 `npm run build` 与 sync 物化；`~/.dsh` 下新增一个 0700 私有目录（生成物，不入库）。
