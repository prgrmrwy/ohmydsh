# Pet 媒体下载改用官方 lark-cli + 受守卫 spool（2026-09-20）

对应 OpenSpec change `pet-media-official-cli-download`（capability `pet-locus-media-access`）。

## 为什么不再维护私有 fork

此前 Pet 为了"媒体字节不存在于任何具名路径"维护一份私有 `lark-cli`：`packages/dsh-pet/compat/lark-cli/`
在冷构建时 clone `larksuite/cli` 到固定 commit `f065bf5`、下载四平台固定 Go 1.23.12 工具链，
再对 `im +messages-resources-download` 打 `bounded-fd-download.patch` 增加隐藏的 `--output-fd` / `--max-bytes`。

实测磁盘代价不是 430 MB 而是 **约 1.7 GB**：`.upstream` 44 MB + `.toolchains` 330 MB + `artifact` 43 MB +
`.cache`（Go build/module cache）约 1.3 GB。删除时全部回收。

这条 seam 换来的独占能力只有一条：**字节不存在于任何具名路径**。但图片最终必然持久化到
`$DSH_HOME/attachments`（content-addressed，规范要求），而那份持久副本的唯一保护**已经**是
Locus child 的 project-read guard（`src/index.ts` 的 `deniedRoots` 指向 `dshHome` / `stateRoot` /
`dshHome/attachments`）。换言之守卫早就是承重层；fd seam 额外保护的只是"网络 → Host 内存"这一跳。

## 现在的做法

1. spool 目录：`$DSH_HOME/plugins/dsh-pet/media-spool`，0700，由 `ensurePetDirectories` 创建。
2. Pet 在 spool 下为**每次调用**创建一个独占子目录 `<spool>/<32-hex>`，以它为 `cwd` spawn 官方
   `lark-cli`，`--output ./<32-hex>.bin`。官方 `--output` 的允许根是 cwd / /tmp / ~/files，而 cwd
   由 Pet 决定；`$DSH_HOME` 不在官方 denylist 内，却已经在 child 的 `deniedRoots` 内 —— 因此
   **不需要改守卫代码**，只需要一条测试钉住这个不变式。
3. 有界：官方路径模式**没有任何字节上限**，所以 Pet 每 50 ms 量一次子目录内最长条目，
   超限立即终止整个进程组。
4. 清理：成功/非零退出/Abort/timeout/进程错误一律在同一次调用内**递归删除该子目录**；
   Pet 启动时清空 spool 根（此刻不可能有在飞下载，里面任何东西都是崩溃残留）。
5. 可用性：官方 binary 必须能解析且 `lark-cli --version` 等于 pin `1.0.94`，否则 media port 保持
   unavailable、只记一条日志、文字 Delivery 继续（fail-soft 语义未变）。

## 明确接受的退化

**失去"已知 Content-Length 读前拒绝"。** patched fd 模式能在输出任何字节之前拒绝超限资源；
官方路径模式没有这个能力，因此补偿是三重的：写入期轮询终止（最坏多写约 50 ms × 本地写入速率）、
下载后尺寸与 receipt 校验、以及无条件删除。

**隔离依据从"物理无路径"改为"路径位于 child 被拒 root 内"。** 这推翻了归档 change
`pet-locus-delivery-safety-hardening` 的 design 中"project-read guard 不再作为媒体隔离依据"的决定；
`test/locus-project-read-guard.test.ts` 因此新增一条用例，断言 spool 位于 `locusDeniedRoots(paths)`
之内且 `read` / `read_image` / `glob` / `grep` 对其中文件全部被拒。

## 观察到的约束（未改动）

- project-read guard 会同步 `realpath` 每个 denied root，**任一根不存在即 veto child publication**。
  生产环境依赖 `$DSH_HOME/attachments` 已被 DSH 物化；写相关测试时必须先建出该目录。
- guard 还会拒绝"workspace 与 denied root 互相包含"，所以项目根必须落在 `$DSH_HOME` 之外。
- 官方 CLI 的 `FileIO().Save` 是**原子写**（temp + rename，0600），且不承诺临时文件的名字；
  这正是每次调用独占一个子目录、清理用递归删除而不是按名匹配的原因。
- `--output` 若不带扩展名，CLI 会用 Content-Disposition/Content-Type 推断后缀并改名，因此
  Pet 传的名字固定带 `.bin`，并校验 receipt 的 `saved_path` basename 与自己给的名字一致。
