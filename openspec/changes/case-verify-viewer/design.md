## Context

- **前置**：`case-verify-skill` 计划提供以下内容：checking 目录的 JSON 模型、共享模型模块 `scripts/_model.py`（读取与校验 oracle、plan、trails、observations）、`status.py`，以及最小 fixture。**这些目前都还不存在。** 因此本 change 必须等前置 change 实施并验证通过后才能开始；tasks 的第 0 步是核对上述导出接口。
- **原型**位于 nexus 仓 `.acceptance-viewer/`，只作参考，**不得复制 `data/`**：
  - `server.py`，97 行：loopback、Host/Sec-Fetch-Site 校验、sha256 不透明 key、realpath 限定、CSP、HEAD、按魔数识别 JPEG；
  - `app.js`，105 行，加上 `index.html`：列表、筛选、详情、lightbox、`#case=` 深链。其中写死了 `scopePlain`、`prdHeadings` 等需求文案；
  - `test_server.py`：覆盖越权、rebinding、CSP。
- **原型的问题**：`EVIDENCE_ROOT` 是写死的；catalog 用绝对路径；依赖 PyYAML。

## Goals / Non-Goals

**Goals：**
- 任何符合 `case-verify-evidence` 格式的目录都能直接用 view 打开，不需要为具体需求写代码。
- 安全约束不弱于原型。
- 零依赖。

**Non-Goals：**
- PRD 主题映射；在查看器内编辑、标注或纠偏（纠偏仍通过 `observe.py`）；监听文件变化；远程或多机访问。

## Decisions

### D1：view 不走隔离 agent 流程

SKILL.md 的启动策略里，`/case-verify` 会启动一个专用 agent 来跑五个阶段。`view` 是一条确定性命令，不需要模型参与判断，所以主会话直接运行它：

1. 以受管后台任务运行 `python3 -B -u <skill-dir>/scripts/view.py --checking-dir <dir>`，记下 job id。
2. 最多等 30 秒，读取 `CASE_VERIFY_VIEW_URL=` 开头的就绪行。
3. 用 `/health` 核验服务确实可用，然后把 URL 和停止方式（`job_kill <id>`）告诉用户。
4. 如果超时，或进程提前退出，就报告 stderr 并回收这个任务（评审第 1 轮 M2）。

就绪行在脚本里用 `flush=True` 输出，与 `-u` 互为保险。

如果解析出的 checking 目录不唯一，按 spec 停下来询问用户。

### D2：catalog 只存在于内存，静态文件从 skill 目录读取

- `build_catalog.build(dir) -> (catalog_dict, assets_map)`。
  - `assets_map` 的映射是 `key → realpath`，只保存在 server 进程内。
  - key 为 `sha256(relative_path)[:24]`。
- `build_catalog.py --out <file>` 只用于调试，输出到 checking 目录以外的位置。如果 `--out` 落在 checking 目录内，直接拒绝。
- 前端文件从 `<skill-dir>/viewer/` 读取，与 checking 目录无关。因此 view 对 checking 目录完全只读，spec 用 sha256+mtime 来断言这一点。

### D3：汇总规则只在 Python 侧实现

`rollup`、`expired` 和 `superseded_by` 都在构建 catalog 时算好。两种时间线都显示已过期标记；旧记录的原始 status 不改写成 pending，pending 是当前 checkpoint 的计算状态。前端只负责显示和筛选，不重复实现规则，避免两份实现漂移。

checkpoint 的状态直接调用 `status.py` 的函数，与门禁和报告共用同一个计算器。前置 change 修订后，这个计算器已改为在全部有效观察中取最严重的状态，并排除已过期的观察。

oracle 汇总在此基础上还要求：每个参与的 checkpoint 都必须是带证据的 pass；只要有任何一个是 pending，汇总就是 partial（评审第 1 轮 C2）。

结构校验与证据可用性分开处理（评审第 1 轮 M4）：
- 结构非法时整体拒绝；
- 某条证据缺失、sha256 不一致或路径越界时，只把这一条标为 unavailable，其余记录照常浏览。

因此 viewer 调用 `_model` 的读取函数时，需要传入“不校验证据文件”的选项。前置 change 必须提供这个选项，由 tasks 0.1 核对。

### D4：catalog 结构

```json
{
  "schema": 1,
  "generated_at": "...",
  "title": "<plan.meta.feature>",
  "oracles": [{"id","title","precondition","input","expected","provenance","source","path","priority","checkpoint_ids","rollup"}],
  "checkpoints": [{"id","trail_id","trail_name","description","focus","verify","origin","oracle_ids","status","observation_ids"}],
  "observations": [{"obs_id","checkpoint_id","plan_rev","expired","loop","batch","env","status","actual","limits","supersedes","superseded_by","at",
                    "evidence":[{"name","kind","scope","url"?,"unavailable"?}]}],
  "gaps": {"uncovered_oracles":[], "derived_checkpoints":[]},
  "env_keys": ["role","shape",...]
}
```

`env_keys` 是所有观察记录中出现过的 env 键的并集，前端据此动态生成并列的列，不预设任何角色名。

### D5：server 从原型改写

保留原型的结构和安全头，但做以下改动：

- 证据根改为启动参数指定的 checking 目录的 realpath。
- 静态路由只把 4 个精确路径（`/`、`/app.js`、`/logic.js`、`/style.css`）映射到 skill 的 `viewer/` 目录，不托管整个目录；checking 根目录的 realpath 校验只作用于 `/asset/`。
- 路径先 `unquote`，再精确查表。
- 返回文件前用 `os.path.commonpath` 再校验一次。Python 3.9 也可以用 `Path.is_relative_to`（3.9+ 支持）。
- `dom` 类证据以 `text/plain; charset=utf-8` 返回。
- 用 `ThreadingHTTPServer` 绑定 `('127.0.0.1', port)`。

### D6：前端从原型改写

原型的写死文案、品牌标题和 PRD 映射全部去掉，只保留以下交互：左侧目录 + 右侧详情、lightbox、hash 路由、只用 `textContent` 渲染。新增内容：

- 视角切换；
- env 并列列；
- 纠偏标注；
- 汇总旁的“计算值”标注；
- 深链未找到时的提示。

前端分两层，测试也分两层（评审第 1 轮 M3）：
- `viewer/logic.js`：纯函数，负责筛选、搜索、hash 解析，以及按 loop/env 分组。
- `viewer/app.js`：渲染与事件接线，导出 `mount(document, catalog)`。

两个文件都是 ES module。`index.html` 通过 `<script type="module" src="/app.js">` 加载，`app.js` 以 `import './logic.js'` 引入逻辑模块：浏览器会请求 `/logic.js`，Node 测试则按相对文件路径直接加载生产模块，不需要为测试重写导入路径。

Node 侧测试：
- 直接测试 `logic.js`。
- 对 `app.js`，测试里写一个约百行的最小 DOM 替身，只实现 `createElement`、`textContent`、`append`、`replaceChildren`、`addEventListener`、`dispatchEvent` 和按 id 的 `querySelector`，再调用生产代码的 `mount`。断言节点文本、视角切换、纠偏标注、lightbox 的打开与关闭，以及 Escape 行为。另用一条含 HTML 标签的 expected，断言不会生成 `img` 元素。

代码约定只用 `textContent`、不用 `innerHTML`，这样上面的替身才能覆盖到。不引入 jsdom 或无头浏览器。浏览器内的视觉检查作为单独的人工验收，记在 verify.md，不算作自动化已覆盖。

### D7：fixture 复用前置 change 的最小目录并扩充

在 `tests/fixtures/minimal/` 的基础上补齐 viewer 场景所需的数据：

- O-1 被 C1、C3 挂载；O-2 未覆盖；
- C2 为 derived，并且引用了 O-2；
- 观察记录包含纠偏、无证据的 pass、网络证据；
- 一张 1×1 PNG。

指向目录外部的符号链接在测试运行时创建，不入库。

## Risks / Trade-offs

- **catalog 是快照，执行中查看会看到旧数据。** 页面显示 `generated_at`，提示用户重启 view 来刷新。
- **证据很多时，`/api/catalog` 会比较大。** 原型有 4772 个文件，catalog 只包含被引用的证据（原型约 230 条关联），可以接受；暂不分页。
- **端口默认为 0，每次地址都不同。** 支持用 `--port` 固定端口；实际 URL 以就绪行为准。
- **TOCTOU（检查与使用之间的竞态）。** 返回文件前会再做一次 realpath 校验，但校验和真正打开之间仍有一个极小的窗口。威胁边界明确为：不防御能以同一用户身份并发篡改 checking 目录的进程，因为这样的进程本来就能直接读到这些文件。本工具只防止经 HTTP 越权访问。
- **只读断言的边界。** 只读断言比较以下几项：sha256、`st_mtime_ns`，以及目录和符号链接条目的集合；前提是测试期间没有其他写入者。它无法证明“短暂写入后又删除”这种情况，因此额外断言：生产读路径不创建任何 lock、cache 或 pycache（以 `-B` 运行，且目录条目集合不变）。

## Migration Plan

纯增量改动，回退时删除新增的文件即可。没有部署结构变化：skill 目录本来就由 sync 整体复制。

## Open Questions

无。
