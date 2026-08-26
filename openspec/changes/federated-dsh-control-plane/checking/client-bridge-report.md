# 浏览器侧 bridge 实现（任务 6.8，继续推进但仍未完成）

## 上一轮的缺口

`applyFederationClient()` 需要一个 `FederationClientBridge`，但它是函数式接口，
只能由代码传入；DSH 从 YAML 加载插件**无法传函数**，而且仓库里没有任何代码构造它。
结果是浏览器端永远走 "no bridge" 分支，真实部署渲染官方 UI。

## 本轮实现

### 1. `FederationBridge`（`src/client/bridge.ts`）

经**通用 Connection 通道**（`connection.rpc.call('/api', 'federation/nodes')`）向
Host 取节点集——不占用任何官方路由。就绪判定刻意严格：

- 调用失败 / 传输抛错 → 不就绪；
- 没有任何启用节点 → 不就绪；
- 任一启用节点缺 runtime binding → 不就绪，并在诊断里点名该节点；
- 全部满足 → 就绪。

畸形条目（空 `nodeId`、缺 `kind`、非法 `kind`、非对象）被丢弃而非信任；未知
`state`/`compatibility` 保守降级为 `CONNECTING` / `INCOMPATIBLE`。
`invalidate()` 只丢就绪状态，保留最后已知节点列表以便展示诊断。

### 2. 默认 bridge 在 `apply()` 内部构造（`src/client/runtime-bridge.ts`）

这是让 YAML 加载的插件也能激活的关键：调用方传入的 bridge 优先（测试/嵌入方），
否则从 `ctx.get('connection').rpc` 自建。

### 3. 修了一个真实的时序缺陷

首版 `refresh()` 是异步的，而 `activate()` 只调用一次——它在 bridge 仍在刷新时读到
`ready() === false`，于是**永远错过就绪窗口**。这是设计缺陷而非测试假象。

现在改为**有界重试**：bridge 未就绪时按 `retryMs` 重试（上限
`maxActivationAttempts`）；但 abdication 或 timeout 造成的 fallback **不重试**——那是
该浏览器已经作出的、终身有效的决定。

## 验证（真实 rc.2 SlotCore）

| 场景 | 结果 |
| --- | --- |
| 无 bridge | 不注册任何 slot、不订阅 entry error |
| bridge 未就绪 | sidebar 与 hero 都保持官方 |
| 启用节点缺 binding | fail closed |
| bridge 就绪 | 同时遮蔽两面，registry 恰好「官方 1 + 联邦 1」 |
| 真实 abdication | 两个联邦面一起处置，官方恢复 |
| **默认 bridge 路径**（不注入 bridge） | 向 Host 发出 `/api:federation/nodes` 并成功激活 |

## Mutation 检查

| 变异 | 结果 |
| --- | --- |
| 取消激活重试（回到单次尝试） | **检出** |
| `apply()` 不构造默认 bridge | **检出** |
| 缺 binding 仍判为 ready | **检出** |

## Round 18：远端投影运行时与真实 Hero Picker（6.8 已完成）

### `NodeProjectionRuntime`（`src/client/node-runtime.ts`）

每个远端节点一份浏览器投影，只暴露官方 Workspace/Session 子树读取的那两个 store
形状。关键不变量已验证：

| 不变量 | 验证方式 |
| --- | --- |
| 跨节点隔离 | 两个节点用**相同 native id**，vm-b 的帧被 vm-a 拒绝（`accept` 返回 false） |
| projection 高 seq 优先 | 迟到的低 seq title 帧不覆盖 |
| archive 帧只对本节点切片权威 | 混合列表只保留自己的 id |
| 非 title / 非字符串 projection | 忽略而非信任 |
| current 只接受本节点已知 session | 外来或未知 id 被拒 |
| invalidate | 丢就绪但保留最后已知树（离线只读骨架） |
| 未知帧类型 | 忽略而非抛错 |

### 远端 binding 与 baseline hydration

`bindingForNode` 现在对远端节点返回真实 binding：读取走该节点的投影，写入经通用
Connection 通道带联邦 id 交给中央 uplink 路由。`createRuntimeBridge` 为每个启用的
远端节点拉 `federation/baseline`，装载后再重新评估就绪。

### 真实 Hero Picker

`Hero` 此前是 `() => Sidebar()` 占位（任务 7.6 已被标完成，属于**高估**，已在
tasks.md 注明）。现在渲染真实 `FederatedHeroPicker`：只提供可写节点、远端节点标注
`browse` 目录模式、点击时优先复用 blank session 而非新建。渲染断言检查
`data-federation-hero-picker` / `-picker-node` / `-directory-mode` / `-picker-workspace`。

### 一个真实的覆盖缺口（先 SURVIVED 后修复）

「未就绪的远端也返回 binding」变异**最初存活**——因为当时没有任何用例覆盖
「远端节点 baseline 加载失败」。补上该用例（`federation/baseline` 返回 `ok: false`）
后变异被检出。这正是 mutation testing 的价值：绿色测试并不等于有覆盖。

### Round 18 mutation 结果

| 变异 | 结果 |
| --- | --- |
| 远端节点不再 hydrate baseline | **检出** |
| 未就绪的远端也返回 binding | **检出**（补用例后） |
| 跨节点帧不再隔离（`ownsSession` 恒真） | **检出** |
| Hero 退回复用 sidebar | **检出** |
| 远端节点误报 `native` 目录模式 | **检出** |

## 历史记录：round 17 时远端节点尚无 binding

必须明确：`bindingForNode()` 对 **`kind !== 'local'` 的节点返回 `undefined`**。

`This Mac` 今天可以服务——它的 sessions/workspaces 就是官方 client store，动作就是
官方 Host 操作。但远端节点还需要由中央 mux/host 改写喂养的**浏览器侧联邦投影运行时**，
这一层尚未接线。

因此：**一旦注册了任何启用的远端节点，bridge 就不就绪，整个浏览器保持官方 UI。**
这是刻意的保守默认（宁可全官方，也不渲染空的远端子树），但意味着任务 6.8 的
「Node Shell/Embed/Picker 在联邦模式下真实可用」尚未达成。

另外 Hero Picker 目前仍复用 sidebar 子树占位，需要接入已单测覆盖的
`FederatedHeroPicker`（blank-session 复用语义）。

## 一个坦白的实现气味

`runtime-bridge.ts` 里有较多 `as unknown as` 转换，因为它要把官方 client store 适配
成 Embed 期望的 props 形状。这是刻意的局部妥协：`ClientContext` 的运行时形状由 rc.2
拥有，而联邦不应把 rc.2 类型泄漏进 Core。远端投影运行时落地时应当一并收敛这些转换。

## 一次未复现的间歇失败（如实记录）

稳定性抽查时出现过 **一次** `95 passed / 1 failed`，但 `npm test` 的摘要不含失败测试
名。随后：根套件连续 **6 轮**全部通过（96/96），新增的
`federation-client-entry-wiring.test.mjs` 单独连跑 **8 轮**全部通过。

未能复现，因此**不声称已修复**。可疑面是根套件里多个测试并发抢占端口/子进程的既有
竞争（本轮新增测试不涉及端口）。若再次出现，应先用
`node --test <单文件>` 逐个隔离，而不是重跑掩盖。

**Round 19 复现尝试（按上述承诺执行）**：又出现一次 `98 passed / 1 failed`。随后：

- 根套件连跑 **6 轮**，全部 99/99；
- `federation-host-entry-wiring` 单文件连跑 **6 轮**全过；
- 把三个重端口/子进程的测试（host-entry-wiring、central-path-live、
  live-event-streams）**并发**跑 **3 轮 × 3 文件**，全部通过。

仍未复现，且 `npm test` 摘要不打印失败测试名（`not ok` 未出现在捕获输出里），所以无法
定位到具体用例。**结论：这是一个低频、尚未定性的既有 flake，不声称已修复。**
建议后续在 CI 上打开 `--test-reporter=spec` 保留失败名，再针对性隔离。

## 验证结果

`dsh-federation` 包 **126 passed**；根 `npm test` **96 passed, 0 failed**；typecheck
通过。未触碰 `~/.dsh`；`dsh.yaml` 保持 `enabled: false`。
