# 批 B 核验：storage 自持可行性

**结论：4/4 通过。批 B 准入闸放行，`storage-atomic.patch`（32 hunks / 4 个上游包）可移除。**

## 环境

| 事实 | 值 |
|---|---|
| Spike 根 | `/tmp/pet-compat-spike/`（隔离，未触碰 `~/.dsh` 与生产 Pet 数据） |
| Node | v24.16.0 |
| SQLite | 3.51.0（`node:sqlite` 内置 `DatabaseSync`，**无原生依赖**） |
| 现网 Host | 未重启、未改配置、未跑 `dsh build` |

**关键前提已确认**：官方 `@deepseek-ai/dsh-storage-sqlite` 本身就用 `node:sqlite` 的 `DatabaseSync`（`lib/index.js:3`），因此自持不引入任何新的原生依赖或驱动差异 —— 用的是同一个底层绑定。

## 5.1 跨表写入全有或全无 — PASS

脚本：`atomicity.mjs`。两张表 `a`/`b`，事务体内先改 `a`、再插 `b`，然后抛错。

```json
{ "test": "5.1 cross-table all-or-nothing",
  "threw": "simulated failure after staging",
  "a_value": "original", "b_rowcount": 0, "PASS": true }
{ "test": "5.1b commit path",
  "a_value": "committed", "b_rowcount": 1, "PASS": true }
```

`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 提供与 patch 版 `Domain.transaction()` 等价的全有或全无语义。对照组确认成功路径确实提交，排除"因为什么都没写所以看起来原子"。

## 5.2 介质独占 — PASS

脚本：`exclusive.mjs`，两个**真实独立进程**。

```json
{"role":"holder",  "acquired":true}
{"role":"intruder","acquired":false,"code":"ERR_SQLITE_ERROR","msg":"database is locked"}
intruder exit=3
```

`PRAGMA locking_mode = EXCLUSIVE` + 强制 `BEGIN IMMEDIATE` 获取锁后，第二个进程**明确失败且可诊断**（结构化 `code`，非静默降级）。这与 patch 版 `exclusive: true` 与 `StorageErrorCode 'medium-locked'` 的保证等价；错误码名称不同，映射由 Pet 门面负责。

## 5.3 保证不可得时 fail closed — PASS

脚本：`failclosed.mjs`。锁被占用时，门面尝试 `BEGIN IMMEDIATE` 失败即拒绝整次写入。

```json
{ "test": "5.3 fail closed when guarantee unavailable",
  "refused": true, "reason": "TRANSACTION_UNAVAILABLE: ERR_SQLITE_ERROR",
  "value_unchanged": true, "PASS": true }
```

关键点：拒绝后目标行**保持写入前的值**，证明没有发生"降级为逐项裸写"。这正是四个 store 类现有 `supportsTransaction !== true → reject` 分支要保护的不变量，自持后该分支应保留（tasks 6.3）。

## 5.4 `domain/changed` 不受介质变更影响 — PASS（静态证明，无需运行时）

三个事实叠加即可判定：

1. 事件由**官方** `storage-domain` 发射：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js:286` `this.ctx.emit("domain/changed", change)`，位于 `emitChanged()`，是 Domain 实例的行为，不属于任何 backend。
2. Pet 的**唯一**监听点 `src/host/archive.ts:276` 第一件事就是 `if (change.domain !== 'workspace') return` —— 只关心 workspace 域的 global 行（官方会话归档集合）。
3. Pet 自己的域是 `dsh_pet`（`src/host/spec.ts:26`）。

即：Pet 监听的是**别人的**域，而自持只改变 `dsh_pet` 的存放方式。两者无交集。

**此项修正了一个早期误判**：曾以为 storage 自持会失去 `domain/changed` 能力，实测表明该订阅与 Pet 数据存放位置完全无关。

## 对批 B 实施的输入

- 门面需把 `ERR_SQLITE_ERROR / database is locked` 映射为 Pet 既有的 `medium-locked` 语义，保持上层 store 的错误处理不变。
- `supportsTransaction` 保留为能力探测（自持下恒真），**但 fail-closed 分支不得删除** —— 5.3 证明介质异常时它仍是最后一道防线。
- `PRAGMA locking_mode = EXCLUSIVE` 的"必须停机迁移"约束继续成立，`scripts/migrate-state-version.mjs` 的存在理由不变（tasks 6.6）。
- `ctx.on('domain/changed')` 订阅**零改动**。

## 未在本轮覆盖（留给实施阶段）

- 真实 Pet 数据规模下的性能对比（本轮只验证语义，不验证吞吐）。
- Host 重启后恢复未完成 Task/Invocation 的端到端（tasks 6.5，需完整 Host，非本 spike 范围）。
