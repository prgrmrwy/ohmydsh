## Why

我们之前为一次长周期验收手搓过一个本地证据查看器。用户反馈它很好用，但没法复用：900 行 catalog 构建脚本里写死了当次的批次目录，还依赖 PyYAML；catalog 里存的是绝对路径；PRD 映射和角色文案都是硬编码的。

前置 change `case-verify-skill` 已经把 checking 目录改造成结构化数据：冻结的 `oracle.json`、带追溯字段的 JSON trail、只追加的 `observations.jsonl`，证据也已分层。在这份数据之上，查看器只需要一个通用的只读入口。用户的诉求是由同一个 slash 承担两件事：

```
/case-verify                        # 原流程：oracle → trail → 执行 → report
/case-verify view [<checking-dir>]  # 只读：构建 catalog，启动本地查看器
```

## What Changes

- 新增 `view` 子命令。它不进入隔离 agent 的五阶段流程，只运行 `scripts/view.py`：先在内存中构建 catalog，再启动本地查看器并打印 URL。它不执行用例，也不修改 checking 目录中的任何文件。
- 新增 `scripts/build_catalog.py` 作为 catalog 的唯一构建入口。它只读取 oracle、plan、trails 和 observations，复用前置 change 的模型模块和 `status.py` 的规则，并计算每个 oracle 的汇总状态与覆盖缺口。
- 新增 `viewer/` 静态前端（原生 JS ES module：`app.js` 负责渲染和事件，`logic.js` 是纯函数），提供两种视图：
  - **按 oracle**：expected、关联的 checkpoint、观察时间线、汇总状态（明确标注为计算值，不是验收结论）、未覆盖标记；
  - **按 checkpoint**：关联的 oracle、按 loop/env 并列的观察时间线、derived 标记、纠偏标记。

  支持搜索、筛选、截图放大和 hash 深链。
- 复用原型 server 的安全约束：
  - 只监听 loopback；
  - 校验 Host 头，拒绝 cross-site 请求；
  - 证据只能通过不透明 key 访问，并用 realpath 限定在 checking 目录内；
  - 不下发原始网络内容；
  - 设置 CSP、`nosniff`、`no-store`。
- 不做 PRD 主题映射，不支持编辑或标注，不支持远程访问，不监听文件变化（catalog 是启动时的快照）。

## Capabilities

### New Capabilities

- `case-verify-viewer`：`view` 子命令的只读约束、catalog 构建、两种视角、oracle 汇总规则，以及查看器服务的安全约束。

### Modified Capabilities

无（依赖前置 change 新建的 `case-verify-skill` 和 `case-verify-evidence`，不修改其中的 requirement）。

## Impact

- `skills/case-verify/`：
  - SKILL.md 在触发方式中增加 `view`；
  - 新增 `scripts/build_catalog.py`、`scripts/view.py`、`viewer/{index.html,app.js,logic.js,style.css}`；
  - 新增 tests（catalog、server、前端纯函数）。
- 运行时：Python 3.9+ 标准库，以及浏览器。不新增依赖。
- 前置依赖：`case-verify-skill` 必须先实施并验证通过。它目前只完成了规划，模型模块、`status.py` 和 fixture 都还不存在，所以本 change 的实施要排在它之后。
