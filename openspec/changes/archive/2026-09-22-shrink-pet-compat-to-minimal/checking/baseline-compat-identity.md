# 基线：当前 compat 身份（任务 1.1）

采集时间 2026-09-22，只读采集，未重启 Host、未运行 `dsh build`。

## Patch 身份

| Patch | SHA-256 | hunks | 上游文件数 |
|---|---|---:|---:|
| `settlement-notice.patch` | `68f9531ad03ae0a1c6a9cebc3884f04ee2b1dca1cad542f0a832246fa978e8a0` | 40 | 14 |
| `storage-atomic.patch` | `188e5aac118b5835f0ff0b7b9a4c1794c92e64f340602e39f59eba09375c4b7e` | 32 | 15 |
| **合计** | | **72** | **29** |

上游 base：`fb2c4b9e698e30edb738bca4cf0618587db7d203`（tag `dsh-v0.1.5-rc.2`）

## Launcher

| 事实 | 值 |
|---|---|
| 当前 fingerprint | `cef535d879fc42f00c7032ff54b4024394a6019e0d7ab19cea1686a1f938654b` |
| 保留代数 | 2（`5f4fb729…`、`cef535d8…`） |

> 注：本次采集期间 fingerprint 由 `5f4fb729…` 变为 `cef535d8…`（`dsh-startup.log` 2026-09-22T06:52:15 有一次启动）。经用户确认，该重启由另一个 session 触发，与本 change 无关。**但它恰好演示了下节记录的双通道漂移**：launcher 重建了一代，profile 侧纹丝不动。

## 两条投影通道的 provenance（漂移已确认）

### 通道一：`.launcher/node_modules`（fingerprint 门禁，自验证）

| 包 | 版本 | upstreamBase |
|---|---|---|
| `dsh-subagent` | `0.1.5-rc.2-locus-settlement-notice.2` | `fb2c4b9e` |
| `dsh-storage` | `0.1.5-rc.2-locus-atomic.2` | `fb2c4b9e` |
| `dsh-storage-domain` | `0.1.5-rc.2-locus-atomic.2` | `fb2c4b9e` |
| `dsh-storage-json` | `0.1.5-rc.2-locus-atomic.2` | `fb2c4b9e` |
| `dsh-storage-sqlite` | （不在该层，由 profile 提供） | — |

### 通道二：`~/.dsh/profiles/web/node_modules`（`compatDependencies`，仅内容 hash 门禁）

| 包 | 版本 | upstreamBase |
|---|---|---|
| `dsh-storage` | **`0.1.2-rc.1-locus-atomic.1`** | **`a66e4702`** |
| `dsh-storage-domain` | **`0.1.2-rc.1-locus-atomic.1`** | **`a66e4702`** |
| `dsh-storage-json` | **`0.1.2-rc.1-locus-atomic.1`** | **`a66e4702`** |
| `dsh-storage-sqlite` | **`0.1.2-rc.1-locus-atomic.1`** | **`a66e4702`** |
| `dsh-subagent` | （不存在于该层） | — |

**漂移确认：profile 侧四个 storage overlay 落后整整一个版本族**（0.1.2 vs 0.1.5），`upstreamBase` 分别为 `a66e4702` 与 `fb2c4b9e`。

根因：`compatDependencies` 按「名称 + 路径 + 内容 hash」判定新鲜度，**不校验 `dsh_compat.upstreamBase`**；而 `build-launcher.cjs:201-215` 对自己那棵树恰恰做了该校验。这正是任务 2.1 要补的洞。

## 能力 marker（收敛目标：5 → 1）

当前 `build-launcher.cjs:137-162` 校验 5 个：

| Marker | 批次归属 | 目标 |
|---|---|---|
| `supportsSettlementNotice` | 保留（唯一成立 seam） | ✅ 保留 |
| `supportsIdleContinuableCreate` | 批 C（误判） | ❌ 移除 |
| `supportsLiveContinuableChildSession` | 批 C（误判连带） | ❌ 移除 |
| `supportsIndependentContinuableCreate` | 批 C（误判） | ❌ 移除 |
| `supportsIsolatedQueuedTurnClaim` | 批 A（从未启用） | ❌ 移除 |

## 回滚锚点

| 项 | 恢复方式 |
|---|---|
| Patch | 两个 `.patch` 文件的上述 SHA-256 |
| Launcher | `.launcher-builds/5f4fb729…` 与 `cef535d8…` 两代保留 |
| Manifest | `dsh.yaml` 的 `dshVersion: 0.1.5-rc.2` + `supportedDshVersion: 0.1.5-rc.2` + 4 条 `compatDependencies` |
| Pet 数据 | `~/.dsh/plugins/dsh-pet/state.sqlite`（批 B 实施前按 6.1 另做一致性备份） |

## 能力与测试基线（任务 1.2）

采集于同一工作树，未改动任何代码。

| 套件 | 结果 |
|---|---|
| `packages/dsh-pet` `npm test` | **154 files passed / 3 skipped；2696 tests passed / 43 skipped**（91.98s） |
| 仓库根 `npm test` | **134 pass / 0 fail**（123.9s） |

这两个数字是后续每一批次的回归对照：任一批次完成后必须复跑并与此比对，**允许总数变化（移除 patch 会带走其测试），但不允许出现 fail，也不允许 skip 数上升**。

### 运行时能力基线

| 能力 | 当前状态 | 依据 |
|---|---|---|
| locus child 创建 | 走 `createIdleChild` → patch 的 `createIdleContinuable` | `src/index.ts:1706` 是唯一生产调用点 |
| `createChild` → 官方 `startContinuable` | **代码存在但零调用** | `child.ts:957`，grep 确认无生产调用方 |
| 结算通知抑制 | `settlementNotice: 'silent'`，创建前 fail-closed 校验 marker | `child.ts:943-945` |
| inquiry 队列隔离 | **未启用**（fail-closed 顶着） | `build-launcher.cjs:54` `overrideRuntimeAgent = false` |
| Pet 持久化 | 宿主 `storage-domain` + patch 的 `transaction()` | 4 个 store 类共 12 处调用 |
| `domain/changed` 订阅 | 监听 **workspace** 域（非 Pet 自有域） | `src/host/archive.ts:276` |
