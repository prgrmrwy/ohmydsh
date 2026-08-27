# 浏览器入口接线（任务 6.8，部分完成）

## 已完成的部分

`src/client/index.ts` 的 `apply()` 原先是空壳，现在真正调用
`applyFederationClient()`，把 Node Shell 组合成两个 slot 贡献
（`sidebar.workspaces`、`conversation.hero.workspace`，priority `-1`），并交给
已验证的 `ClientActivationController` 管理生命周期。

对**真实 rc.2 `SlotCore`** 验证通过：

| 场景 | 结果 |
| --- | --- |
| 无 bridge | 不做任何 slot 注册、不订阅 entry error，官方入口原样保留 |
| bridge 未就绪 | 不遮蔽 sidebar，也不遮蔽 hero |
| bridge 就绪但某节点缺少 binding | fail closed，官方继续获胜 |
| bridge 就绪 | 同时遮蔽 sidebar 与 hero，registry 中恰好「官方 1 + 联邦 1」 |
| 真实 abdication（`reportEntryError(..., { abdicate: true })`） | 该浏览器的**两个**联邦面一起处置，官方两面都恢复 |
| dispose | registry 只剩官方条目 |

每个节点使用独立 view store（`nodeSectionKey` 作为 key），因此展开、选中和拖拽
状态不会跨节点泄漏。

## 尚未完成：bridge 没有实现

必须明确说明，否则会误导验收：

`FederationClientBridge`（`nodes()` / `bindingFor()` / `ready()`）是一个**函数式
接口**，只能由代码传入。DSH 通过 YAML 清单加载插件，**无法传递函数**，而且仓库中
**没有任何代码构造这个 bridge**：

```
$ grep -rn "FederationClientBridge" src --include=*.ts --include=*.tsx | grep -v entry.tsx
(无结果)
```

浏览器端也还没有从 Host 获取节点列表与 per-node 运行时绑定的数据通路（`nodes()` /
`bindingFor()` 需要的 workspace/session hooks 目前没有来源）。

**因此实际部署仍然渲染官方 UI。** `apply()` 会走 "no bridge" 分支并直接返回，这是
设计上的保守行为，但不能被当作「联邦 UI 已可用」。任务 6.8 保持未完成。

## 仍缺的接线

1. 浏览器侧联邦运行时：订阅中央改写后的 mux/host 帧，维护每节点的
   sessions/workspaces 投影；
2. 由该运行时实现 `FederationClientBridge` 并在 `apply()` 内部构造（不依赖外部
   传参），使 YAML 加载的插件也能激活；
3. Hero Picker 目前复用 sidebar 子树占位，需要接入
   `FederatedHeroPicker`（blank-session 复用语义已单测覆盖）。

## Mutation 检查（诚实记录）

| 变异 | 结果 |
| --- | --- |
| 跳过「缺少 binding」检查 | **检出** |
| 同时移除 `isHostReady` 与 `prepare()` 内的 ready 检查 | **检出** |
| 只移除 `isHostReady`（保留 `prepare()` 检查） | 存活 |
| 只移除 `bridge === undefined` 早退（保留 `prepare()` 检查） | 存活 |

后两项属于纵深防御：两处检查独立成立，去掉任一处另一处仍然拦住，因此单点变异不
可检出——与之前 event-stream generation 守卫、registry CAS 的情况相同。同时移除
两层则被检出，说明该不变量确实有覆盖。

## 一个已修的测试缺陷

首版测试把 esbuild 产物写进临时目录，导致 `react` 等 external 无法解析；改为写入
仓库 `node_modules/.cache`。随后发现每次运行会残留 `.css` 侧车文件（
`--loader:.css=local-css` 产生），清理逻辑只删了 `.mjs`。现已一并清理，验证运行后
残留为 0。

## 验证

`dsh-federation` 包 **120 passed**；根 `npm test` **95 passed, 0 failed**（连续
三次）；typecheck 通过。未触碰 `~/.dsh`；`dsh.yaml` 保持
`dsh-federation: enabled: false`。
