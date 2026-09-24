## Context

见 `proposal.md`。当前 `wsClean`（`maintenance.ts`）用两条 Git 断言证明分支状态：

1. `merge-base --is-ancestor <baseCommit> <taskHead>` —— 分支仍从记录的 base commit 长出（防历史被重写后误删）。
2. `merge-base --is-ancestor <taskHead> <baseTip>` —— 分支已合入 base ref。

第 2 条只认祖先关系。rebase 重写 commit hash 后，内容虽已在主干，原 commit 却不再是主干祖先，于是判定失败。本仓库 2026-09-04 真实发生：`ws/pet-send-cr-send-cr-skill-map-workspace` 的全部内容已在 `main`，`ws clean` 仍以 `not proven merged` 拒绝。

`git cherry <upstream> <head>` 按 patch-id 比对：上游已有等价 patch 的 commit 前缀 `-`，缺失的前缀 `+`。本仓库实测两种情形都已复现（该分支全 `-`；构造的未合入 commit 为 `+`），判别力可靠。

## Goals / Non-Goals

**Goals:**

- 让 rebase 工作流下已落地的工作能被正常清理。
- 保持"未落地的工作绝不被删"这一核心不变量。
- 判定依据对用户可见、可复核。

**Non-Goals:**

- 不放松任何其他安全门（dirty、active、in-flight、归档、schema、base 祖先校验）。
- 不改变 operation schema、CLI/HTTP 契约与归档生命周期。
- 不引入远端查询：判定只用本地 Git 对象。
- 不试图识别 squash merge 后**内容被修改**的情形——那种情况 patch-id 不等价，按未合入拒绝是正确的保守结论。

## Decisions

### 1. 两级判定，祖先优先

先跑既有 `--is-ancestor`：命中即结束，零额外成本、语义最强。不成立时才跑 `git cherry`。这样常规 merge 工作流的行为与判定开销完全不变，patch 等价只作为 rebase 场景的补充证明。

**替代方案：** 直接用 patch 等价取代祖先判定。否决：祖先关系是更强的证明（连历史结构都一致），没有理由降级；且 `git cherry` 需要逐 commit 计算 patch-id，成本更高。

### 2. 要求"全部 commit 等价"，而非"存在等价"

只有当分支相对 base ref 的**每一个** commit 都返回 `-` 时才判定已合入。任一 `+` 即拒绝。部分等价意味着有工作没落地，正是必须拦住的情况。

### 3. 空差集视为已合入

分支相对 base ref 没有独有 commit 时，`git cherry` 无输出。此时没有任何未落地的工作，与祖先判定结论一致，判为已合入。这一分支必须显式处理，否则"无输出"可能被误当成"无法证明"。

### 4. 判定依据写进结果

`CleanResult` 增加一个字段标明依据（祖先 / patch 等价）。清理是不可逆操作，用户有权知道系统凭什么认定"已合入"——尤其 patch 等价是较弱的证明，值得显式暴露而不是隐藏在同一句话里。

### 5. 只用本地对象，不查远端

`git cherry` 与 `merge-base` 都只读本地引用。保持既有"清理从不依赖网络、从不触碰远端分支"的性质。

## Risks / Trade-offs

- [patch-id 等价弱于祖先关系] → 这是刻意接受的：它恰好刻画"同一改动以不同 hash 落地"。内容一旦被改动，patch-id 即不同，按未合入拒绝。判定依据同时写进结果供复核。
- [cherry-pick 后又在上游被修正] → 上游版本与分支版本 patch-id 不同 → 判为未合入 → 保守拒绝，符合预期。
- [大分支逐 commit 计算 patch-id 的开销] → 仅在祖先判定失败时才执行，且清理本就是低频操作；`git cherry` 由 Git 原生实现，成本可接受。
- [空差集判定] → 显式处理并加测试覆盖，避免"无输出"被误解。

## Migration Plan

1. 无数据迁移：operation schema 与目录布局不变。
2. 部署 package 后重启 Host 生效。
3. 回滚：移除 patch 等价回退分支即回到仅祖先判定，无持久状态残留。

## Open Questions

- 判定依据字段的具体命名与在 `skills/ws/SKILL.md` 中如何向模型描述，实现时定稿。
