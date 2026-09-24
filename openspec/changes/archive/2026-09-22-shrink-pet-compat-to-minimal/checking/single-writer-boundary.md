# Single writer 边界确认（任务 1.3）

## 结论

**满足 single writer 条件，可以开始实施。**

## 依据

| 事实 | 值 |
|---|---|
| 工作树状态 | 干净 —— `git status --short` 仅有本 change 的未跟踪目录 |
| 并行 change `pet-locus-independent-agent-inquiries` | artifacts 4/4 完成，但**任务仅 2/57**（`- [x]` 2 条 / `- [ ]` 55 条） |
| 该 change 是否已动实现代码 | **否**，其已完成的 2 项属规划性质；工作树无对应改动 |

即该 change 目前处于**纯规划态**，尚未进入实施。本 change 是当前唯一的实现侧 writer。

## 共享文件清单（本 change 将修改，该 change 未来也会涉及）

来自 `pet-locus-independent-agent-inquiries/proposal.md:32-33` 的 Impact 声明：

> Pet Host：`src/host/locus/` 的 child/context/仓储/管理/turn-observer、工具与加载装配
> DSH：所需 Host 接缝先做可失败核验；**若需 compatibility patch，沿用已审查、精确 pin 的 Pet Host runtime 流程**

| 文件 / 区域 | 本 change 的动作 | 冲突风险 |
|---|---|---|
| `packages/dsh-pet/compat/subagent/*.patch` | 移除 storage patch、收敛 settlement patch | 高 —— 该 change 明确预留了「若需 compatibility patch」的可能 |
| `src/host/locus/child.ts` | 切换创建路径、移除 marker 门禁 | 高 |
| `src/index.ts:1706` 附近 | `createIdleChild` → `createChild` | 中 |
| 四个 store 类的事务门面 | 改介质实现，保留 fail-closed 分支 | 中 |
| `src/host/locus/composition.ts` | **零改动**（护栏，见 tasks 8.4） | — |
| `dsh.yaml`、`scripts/sync.mjs` | `compatDependencies` 校验与退役 | 低 |

## 约束（沿用 0.1.5 升级 `review.md` 的既有规则）

1. 本 change **只迁移 runtime seam**，不改 `pet-locus-independent-agent-inquiries` 的产品语义、G1–G5 判据或任务状态。
2. 实施期间上述共享区域由本 change 独占写入。
3. 若该 change 在本 change 完成前开始实施，必须先停止其中一方；两者不得并行编辑同一文件。
4. 本 change 合入前 rebase 并复跑 Pet 全量（基线见 `baseline-compat-identity.md`）。

## 对并行 change 的正向影响（值得记录）

该 change 的 `proposal.md:33` 原本就要求「所需 Host 接缝**先做可失败核验**」。本 change 的 spike 已完成该核验并证明官方 API 足够（见 `spike-static-api-evidence.md`），**因此本 change 实际上是在补做该 change 的前置步骤**，完成后会缩小其 compat 面而非扩大。
