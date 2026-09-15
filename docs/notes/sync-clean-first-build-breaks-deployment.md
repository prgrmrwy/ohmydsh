# Backlog：worktree 缺依赖时，sync 的 local build 会清空 `lib/` 并连带打穿部署目录

状态：**待处理**。已实测复现（2026-09-15，`.worktrees/sidebar`），当次故障已由一次
来自主 checkout 的重建自行恢复，根因未修，在同一 worktree 再次 sync 会复发。

相关实现：`scripts/sync.mjs` 的 `runLocalBuild()`（L359）与其调用点（L887）。
触发包：`packages/worktree-session`（`dsh-worktree-session`）。

## 现象

在 worktree 中运行 `node scripts/sync.mjs`，结束时报告一条 failure：

```
[sync] finished with 1 failure(s):
  - local package dsh-worktree-session: npm run build --workspace dsh-worktree-session failed before deployment
```

字面上"failed **before deployment**"读起来像是"部署未被触碰"。**实际不是**：此后
启动 DSH 直接崩溃，整棵 plugin tree 加载失败。

```
Error: dsh: plugin tree failed to load: failed to apply loader entry modules
(@deepseek-ai/dsh-client-modules): client-modules: 1 client package failed to compose:
  client bundles not found; run `pnpm run build` before launch:
    - package: dsh-worktree-session
      path: /Users/bytedance/.dsh/profiles/web/node_modules/dsh-worktree-session/lib/client.js
```

## 成因

三个各自合理的机制叠成了破坏链。

### 1. build 脚本是 clean-first

`packages/worktree-session/package.json`：

```
"build": "npm run clean && npm run build:host && npm run build:client"
"clean": "rm -rf lib"
```

`clean` 先于任何编译执行。只要 `build:host` 失败，`lib/` 就已经是空的，且
`build:client`（产出 `client.js` 的那一步）根本没机会运行。

本例中 `build:host` 的失败原因是 worktree 的 `node_modules` 缺依赖：

```
src/host/tool.ts(5,21): error TS2307:
  Cannot find module '@deepseek-ai/dsh-user-questions' or its corresponding type declarations.
```

该依赖在 `packages/worktree-session/package.json` 中已声明（deps + peerDeps 各一处），
只是没有安装到本 worktree。按仓库规则，改依赖前必须先 `ws promote`。

### 2. sync 的"构建失败就不部署"保护对 clean-first 脚本无效

`scripts/sync.mjs` 的保护是构建失败后 `continue` 跳过部署：

```js
if (needsBuild) {
  delete nextBuiltFrom[name]          // 先撤销 claim，避免坏产物被认证为当前
  if (!runLocalBuild(item, localDir)) continue   // 失败 → 不部署
}
```

这个设计防的是"**把坏产物推到部署目录**"。但本例的破坏发生在 `runLocalBuild`
内部、`npm run build` 的第一个子步骤里——**保护生效时，损坏已经完成**。
`continue` 不部署，恰恰意味着也不会去修复已经被清空的产物。

### 3. `file:` 安装与源目录共享 inode，删源即删部署

local package 以 `file:<dir>` 安装，pnpm 对其内容做**硬链接**而非拷贝。实测：

```
669613573  /Users/bytedance/.dsh/profiles/web/node_modules/dsh-worktree-session/lib/client.js
669613573  /Users/bytedance/mydir/opensource/ohmydsh/packages/worktree-session/lib/client.js
```

同一 inode，link count 2。于是 `rm -rf lib` 清掉源产物的同时，**部署目录的
`client.js` 一并消失**——即使 sync 全程没有执行任何一次部署写入。

三者合起来：一次纯粹的"构建失败"变成了一次对运行中部署的破坏性修改。

## 影响

- 破坏是**跨 checkout** 的。在 worktree 里跑 sync，打穿的是 `~/.dsh` 这份所有
  checkout 共用的部署，进而打穿正在运行的 DSH。
- failure 文案具误导性。"failed before deployment" 会让人（本次包括 AI）判断
  部署侧未受影响而略过检查。
- 检查产物是否完好时，`ls | head -n` 这类截断输出不足以支撑"完好"的结论：本例
  中 `cli.js`、`host/`、`index.js` 全都还在，**唯独缺 `client.js`**，而 client
  bundle 恰是 loader 的硬性前置。判据应是"`package.json` 的 `files`/入口所声明
  的产物逐一存在"，而不是"目录非空"。

## 恢复方式（本次实际发生的）

一次来自**主 checkout** 的重建补回了 `lib/`（含 `client.js` 与 `client.js.map`），
部署侧因共享 inode 同步恢复，随后启动成功。即：在依赖完整的 checkout 里重新
构建该包，即可解除故障。无需手工触碰 `~/.dsh`。

## 待处理

两条互补的方向，尚未实施：

1. **补齐 worktree 依赖**（范围最小，但不消除机制脆弱性）。需先 `ws promote`，
   再安装使 `@deepseek-ai/dsh-user-questions` 就位。
2. **加固 `scripts/sync.mjs` 的 fail-closed 语义**，使构建失败不致留下被清空的
   产物。可选路径：build 前先验依赖可解析；或构建到临时目录、成功后原子替换，
   让"失败"真正等价于"什么都没发生"。属行为变更，按 `AGENTS.md` 应走 OpenSpec change。
