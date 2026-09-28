## Context

`bin/dsh` 在调用任何脚本前执行 `set -a; source "$REPO/.env.local"; set +a`。manifest 消费脚本（`sync.mjs`、`plugin-list.mjs`、`plugin-update.mjs`）本身只读 `process.env`。

`.env.local` 里有两类变量会改变部署内容：

- `DSH_LOCAL_MANIFEST`：决定 overlay 是否存在。
- `enabledEnv` 变量：决定定制的有效启用状态。

裸跑 `node scripts/sync.mjs` 时这两类变量缺席，sync 按「条目已删除」卸载 overlay 包，并以 0 退出。现有 `docs/notes/local-manifest-overlay.md` 只用文字提醒「先 source」，这条提醒已经被踩过。

## Goals / Non-Goals

**Goals**

- 同一 checkout、同一 `.env.local` 下，`dsh build` 与裸跑 `node scripts/sync.mjs` 部署出相同的定制集合。
- `.env.local` 不执行任何 shell。无法按字面值确定的值直接拒绝，不猜测。
- 保持 `npm test` 的 overlay 隔离不变。

**Non-Goals**

- 不让脚本读取 `DSH_HOME`、`DSH_PROFILE`、`DSH_BIN`、`DSH_OPEN_APP`、密钥等其它变量。
  - 这些变量改变的是**部署到哪里、怎么启动**，不是**部署什么**。
  - 纳入它们等于在 JS 里再造一个 shell 环境加载器。
  - 它们继续只由 `bin/dsh` 负责。
- 不改变 `bin/dsh` 的 source 行为。

## Decisions

### D1 只读「决定部署什么」的变量白名单

读取集合 = `{DSH_LOCAL_MANIFEST}` ∪ {合并后 manifest 中所有 `enabledEnv` 名}。

分两阶段填充：

1. 先填 `DSH_LOCAL_MANIFEST`。
2. 再加载「公开 manifest + overlay」，拿到 `enabledEnv` 名后再填它们。overlay 条目自己声明的 `enabledEnv` 因此也覆盖到。

备选方案是读取 `.env.local` 里所有 `DSH_*` 变量。否决原因是它会把 `DSH_HOME` 带进来，而 worktree 的 `.env.local` 普遍设置了隔离的 `DSH_HOME`，会意外改变裸跑 sync 的部署目标。这属于超出本次范围的行为变化。

### D2 调用方环境优先，空字符串也算已设置

- 调用方已设置某变量（含空字符串）时，不读 `.env.local` 中的同名值。
- `npm test` 通过设置变量来屏蔽 overlay；测试夹具用 `DSH_LOCAL_MANIFEST: ''` 表达「无外部 overlay」。两者都依赖这条规则。
- 经 `bin/dsh` 调用时，变量已由 source 设置，脚本不会重复读取，结果与现状一致。

与 bash 语义的差异：bash `source` 会让 `.env.local` 覆盖调用方的值。在脚本入口处，「显式传入优先」更符合预期，而且只在调用方与 `.env.local` 给出不同值时才有区别。

### D3 字面值解析；遇到 shell 语法即拒绝

支持的写法：

- 行格式：`[export ]KEY=VALUE`。
- `#` 整行注释。
- 未加引号的值：去掉 ` #` 之后的注释和首尾空白。
- 单引号：字面值。
- 双引号：只处理 `\"` 与 `\\` 转义。

白名单变量出现以下情况时判为**无法字面确定**：

- 未加引号或双引号的值含 `$` 或反引号；
- 未加引号的值以 `~` 开头；
- 引号未闭合。

判定后的处理：

- sync 与 plugin-update 报错退出，错误信息给出文件、行号和变量名，但不打印值。
- plugin-list 只在标准错误输出提示，并忽略这些值。

不在白名单中的行即使含 shell 语法也不解析、不报错：`.env.local` 可以继续放任意 bash。

备选方案是调用 `bash -c 'source … && env'`。否决原因：它会执行任意代码，而且让仓库脚本依赖 bash。

### D4 修改 `process.env`，统一经 env 参数流转

- 填充直接写入 `process.env`。现有库函数的默认参数都是 `env = process.env`，这样无需逐层透传。
- 子进程会继承被填充的变量。这些变量与 `bin/dsh` 路径下子进程本来就能看到的一致，不引入新暴露面。
- 模块入口在执行主逻辑前调用 `applyEnvLocal`。`sync.mjs` 顶层对 `DSH_HOME` / `DSH_PROFILE` 的读取不在白名单内，不受影响。

### D5 来源可见

每个从 `.env.local` 取值的变量输出一行 `[sync] <NAME> from .env.local`，写在 sync 的标准输出。只写变量名，不写值。plugin-list 不输出这一行，因为它的标准输出是启动清单。

## Risks / Trade-offs

- [用户在 `.env.local` 里用 `$HOME` 拼路径] 裸跑时会报错，此前是静默失效。→ 错误信息写明改为绝对路径或单引号字面值。`bin/dsh` 路径不受影响，因为 source 已经展开。
- [worktree 的 `.env.local` 设置了 `DSH_LOCAL_MANIFEST`] 裸跑 sync 会带上 overlay。→ 这正是与 `dsh build` 一致的预期行为。
