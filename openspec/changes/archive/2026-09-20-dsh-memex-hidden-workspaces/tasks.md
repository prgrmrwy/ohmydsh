## 1. 实现

- [x] 1.1 `workspaceViews()` 之后按 `memory` 拆分活跃块与关闭块（不改视图模型本身的语义）
- [x] 1.2 页面渲染：末尾可折叠分组，标题带数量，默认收起，展开状态为视图状态
- [x] 1.3 文案：分组标题与展开/收起按钮复用既有弱按钮与 `.dshmx-*` 结构，不新增配色
- [x] 1.4 没有关闭项时不渲染分组

## 2. 测试

- [x] 2.1 关闭记忆的工作区块默认不在主列表里，且分组标题带数量
- [x] 2.2 展开分组后该块出现，记忆开关仍可切换并正确落盘（`memory: true`）
- [x] 2.3 没有关闭项时页面上不出现分组标题
- [x] 2.4 展开/收起是视图状态：不产生任何 mutation

## 3. 部署与验收

- [x] 3.1 typecheck / build / 全量测试 / `check:artifacts`
- [x] 3.2 部署（纯客户端改动，HMR 轮询重注册，无需重启）并核对 md5
- [x] 3.3 实机：DSH Pet 收在「已关闭记忆」里，展开可再打开（视图模型已用真实 settings 核对：主列表 7 个、收起组 = DSH Pet；页面呈现已由用户确认）

### 实施记录（2026-09-20）

- 实现：`page.tsx` 把 `views` 按 `memory` 拆成 `active` / `hidden`，块渲染抽成 `renderBlock(view)`
  供两处共用（避免"能不能在收起组里重新打开"依赖第二条代码路径）；分组是 `.dshmx-group` +
  标题带数量 + 复用弱按钮的展开/收起钮，默认收起，展开状态为纯视图状态（`showHidden`）。
  `locales.ts` 新增 `hiddenGroup` / `actionShow` / `actionHide`（中英）。
- 测试：`test/page.test.tsx` 三条新用例（默认收起且标题带数量、展开后可切换回 `memory: true` 并落盘、
  没有关闭项时不出现分组）+ 两条既有断言（展开不产生 mutation、页面上没有 `actionShow`）。全量 **174 例**。
- 实机（真实 settings + 真实注册表）：主列表 = nexus · ohmydsh · dsh-cockpit · flow-web-monorepo ·
  dev-infra-server · multica-runtime · learning；收起组 = **DSH Pet**。
- 部署：纯客户端改动（HMR 轮询重注册），`lib/client.js` md5 `f5c313ec…` 与部署副本一致，`sync` 连跑两次 `no changes`。

