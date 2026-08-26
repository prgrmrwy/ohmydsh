# Cross-process node-registry safety

Automated as `tests/federation-registry-multiprocess.test.mjs`.

## Gap this closes

`NodeRegistryStorage` serializes writes with an in-process promise queue, so the
package test proves single-process CAS only. Two DSH processes can share
`$DSH_HOME/plugins/dsh-federation/nodes.json` — for example an old Host that has
not exited while a new one starts — and there the queue does not apply.

## What is proven

Two genuinely concurrent OS processes race the same registry:

| Phase | Expectation | Result |
| --- | --- | --- |
| both create from `missing` | file exists, parses, lands exactly generation 0 with the single immutable local node | holds |
| both update from generation 0 | exactly **one** commits generation 1; the loser fails closed with `CONFLICT` | holds |
| after the race | file parses; no owned temp files remain | holds |

A losing writer never clobbers the winner, and no interleaving leaves a torn or
partially written file.

## Two test defects found and fixed (both mine)

**1. The writers were not concurrent.** The first version used `spawnSync`
inside `Promise.all`. `spawnSync` blocks the event loop, so the processes ran
strictly sequentially and the "CONFLICT" observed was merely the second writer
reading an already-updated generation — no race ever occurred. Switching to
async `spawn` produced real overlap.

**2. The generation model was wrong.** A create from `missing` must commit
generation 0, but the writer saved a snapshot already mutated by `addRemote`
(generation 1), so *both* creators failed `CONFLICT` and no registry was
written. Verified against the real rule in
`registry-storage.ts` (`expectedGeneration === 'missing' ? generation !== 0 : generation !== expected + 1`)
and corrected: a create commits the bare initial snapshot; an update commits
exactly `expected + 1`.

Neither was a product defect. Both would have left a green test proving nothing.

## Mutation checks — which guard actually matters

With real concurrency in place:

| Mutation in `registry-storage.ts` | Test result |
| --- | --- |
| remove the **first** CAS check (before the temp write) | **passed** — not detected |
| remove the **pre-commit CAS re-check** (immediately before `rename`) | **failed** ✓ |
| remove the **cross-process commit lock** (round 20) | **failed 3/12 runs** ✓ |
| remove **both** | **failed** ✓ |

> **⚠ 本段结论已被 round 20 推翻（保留原文以便追溯）**：pre-commit 复检**并未**关闭
> 跨进程窗口，它只是把窗口缩小到「复检→rename」之间。真正关闭该窗口需要跨进程锁，
> 见下节 round 20。

This is an informative result rather than a weakness. The two checks are
defense in depth: the first rejects a stale caller early, but the guard that
actually closes the *cross-process* window — between reading the current
generation and committing the atomic `rename` — is the **pre-commit re-check**.
Under the earlier sequential fixture, removing it looked harmless; only a true
race reveals that it is load-bearing.

Sources were restored and verified clean (0 mutation markers).

## Round 20：定位并修复真实的丢失更新缺陷

前几轮出现过多次低频 `1 failed`，但 `npm test` 摘要不打印失败用例名，导致无法定位。
本轮先修可观测性：新增 `npm run test:tap`（`--test-reporter=tap` 保留每个用例名），
第 9 轮即捕获到失败：

```
not ok 49 - two OS processes cannot corrupt or silently clobber the node registry
  exactly one update may commit: [{"label":"vm-c","ok":true,"generation":1},
                                 {"label":"vm-d","ok":true,"generation":1}]
  2 !== 1
```

**两个并发进程都报告成功提交 generation 1** —— 一次真实的 lost update，不是测试瑕疵。

### 根因

`#save()` 中的 CAS 复检与 `rename()` 之间存在 TOCTOU 窗口：

```
进程A: load() → 见 gen0 → 通过检查 ─┐
进程B: load() → 见 gen0 → 通过检查 ─┴→ A rename, B rename（静默覆盖 A）
```

两处 CAS 检查都是**同进程内**的判断，无法跨进程互斥。round 13 的报告曾把 pre-commit
复检称为「关闭跨进程窗口的守卫」——**那个结论是错的**：它只是缩小了窗口，并未消除。

### 修复

引入跨进程提交锁：`open(lockPath, O_CREAT | O_EXCL | O_NOFOLLOW)`（POSIX 原子），
把「CAS 复检 + rename + fsync」整段包进临界区。超过 `LOCK_STALE_MS`(30s) 的锁视为
崩溃遗留并回收——永久卡死的锁比偶发双提交更糟。

### 证据（对照实验）

| 配置 | 12 轮并发竞争结果 |
| --- | --- |
| **有锁**（当前） | **0 次失败** |
| 移除锁（变异） | **3 次失败** |

移除锁能重现缺陷、加上锁则消失，因此这不是"跑几轮碰巧过了"，而是有因果证据的修复。

## Verification

`npm test` → **91 passed, 0 failed**; `dsh-federation` package → **117 passed**.
Nothing touches `~/.dsh`; `dsh.yaml` keeps `dsh-federation: enabled: false`.
