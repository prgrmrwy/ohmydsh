# case-verify-viewer Specification

## Purpose

规定 `/case-verify view` 只读子命令：把已有 checking 目录中的结构化证据转换为本地查看器，按 oracle 和 checkpoint 两种视角浏览观察时间线与精确证据；服务只在 loopback 上提供 catalog 中登记的文件。

## Requirements

### Requirement: view 子命令只读且显式选择目录
`/case-verify view [<checking-dir>]` SHALL 只做两件事：构建 catalog，启动查看器。它 SHALL NOT 执行用例、联网，也 SHALL NOT 在 checking 目录内创建、修改或删除任何文件。catalog 只保存在进程内存中。

未给出 `<checking-dir>` 时，SHALL 按 checking 目录解析规则列出候选目录（`openspec/changes/*/checking/` 与 `docs/checking/*/` 中含有 `plan.json` 的目录）：
- 恰好一个候选：直接使用；
- 零个或多个候选：列出候选并以非 0 退出，请用户指定。

`view.py` SHALL 先完成 catalog 构建并成功绑定端口（默认由系统分配），然后在 stdout 输出单独一行 `CASE_VERIFY_VIEW_URL=http://127.0.0.1:<port>/`，并立即 flush。任何启动失败（catalog 构建失败、端口被占用）SHALL 以非 0 退出，且不输出该行。

主会话 SHALL 以受管后台任务启动 `view.py`，保留任务 id，最多等待 30 秒读取上述就绪行。读到后先请求同端口的 `/health` 确认服务可用，再把 URL 告诉用户，同时告知停止方式（结束该后台任务）。如果超时或进程提前退出，SHALL 把 stderr 摘要报告给用户，并结束该任务。

#### Scenario: 运行前后目录不变
- **GIVEN** 一个合法的 fixture checking 目录，记录了其中每个文件的 sha256 与 mtime
- **WHEN** 启动 `view.py --checking-dir <dir> --port 0`，请求 `/api/catalog` 和一张证据图片后关闭服务
- **THEN** 目录中的文件集合、每个文件的 sha256 与 mtime 都与运行前相同

#### Scenario: 管道 stdout 下立即可读到就绪行
- **GIVEN** 合法的 fixture 目录
- **WHEN** 以 stdout 接管道的方式启动 `view.py --port 0`，并在进程仍在运行时逐行读取
- **THEN** 10 秒内读到 `CASE_VERIFY_VIEW_URL=` 行；对该 URL 请求 `/health` 返回 200

#### Scenario: 端口被占用
- **GIVEN** 某个端口已被另一个 socket 占用
- **WHEN** 运行 `view.py --port <该端口>`
- **THEN** 退出码非 0，stdout 中没有 `CASE_VERIFY_VIEW_URL=` 行

#### Scenario: 候选目录不唯一
- **GIVEN** 工作区中有两个含 `plan.json` 的 checking 目录
- **WHEN** 不带 `--checking-dir` 运行 `view.py`
- **THEN** 退出码非 0，stderr 列出两个候选路径，且没有启动服务

### Requirement: catalog 只由结构化文件构建
catalog SHALL 只依据 `oracle.json`、`plan.json`、`trails/*.json`、`observations.jsonl` 以及其中引用的证据路径来构建。它 SHALL NOT 根据文件名或目录内容猜测证据与 checkpoint 的对应关系。

catalog 中的 evidence 对象 SHALL 只包含 `name`（文件名）、`kind`、`scope`，以及 `url`（`/asset/<key>`）与 `unavailable: true` 二者之一；SHALL NOT 包含原始 `path` 或 `sha256`。`network` 与 `log` 类证据按策略不提供下载，因此一律使用 `unavailable: true`。

构建器自行添加的字段 SHALL NOT 包含 checking 目录的绝对路径或资产映射的 realpath。`oracle.path`、`actual`、`limits` 等来源文本属于数据，即使其中含有路径也 SHALL 原样保留。

遇到旧格式目录，或目录中没有 `observations.jsonl` 时，SHALL 以非 0 退出，提示“该目录早于结构化证据格式”或“尚无观察记录”，且不打印 traceback。

#### Scenario: catalog 不泄露实现路径
- **GIVEN** 把 fixture 复制到一个名字含唯一哨兵串的临时目录中；其中一条观察引用了 `evidence/C1/after.png`
- **WHEN** 构建 catalog 并序列化为 JSON
- **THEN** fixture 正文中不含哨兵串的前提下，JSON 文本中不出现该哨兵串；该证据对象的键集合恰好是 `{name, kind, scope, url}`，且 `name` 为 `after.png`

#### Scenario: 正文中的绝对路径照样保留
- **GIVEN** 某条观察的 `actual` 中包含 checking 目录的绝对路径
- **WHEN** 构建 catalog
- **THEN** 该 `actual` 与原文逐字相同；其余由构建器生成的字段中不出现该绝对路径

#### Scenario: 来源文本原样保留
- **GIVEN** 某条观察的 `actual` 为“保存后 evidence/ 目录未出现导出文件”
- **WHEN** 构建 catalog
- **THEN** catalog 中该观察的 `actual` 与原文逐字相同

#### Scenario: 旧格式或无观察
- **GIVEN** 只有 `plan.yaml` 的目录，或者有 `plan.json` 但没有 `observations.jsonl` 的目录
- **WHEN** 运行 `view.py --checking-dir <dir>`
- **THEN** 退出码非 0，stderr 给出对应提示，不包含 `Traceback`，且没有启动服务

#### Scenario: 证据缺失或越界
- **GIVEN** 一条观察引用的证据文件已被删除；另一条引用的是指向 checking 目录外部的符号链接
- **WHEN** 构建 catalog
- **THEN** 这两条证据都标为 `unavailable: true`，均不生成 `url`；其余证据不受影响

### Requirement: oracle 汇总采用保守规则且标明为计算值
每个 oracle 的**参与集合**是：`oracle_ids` 中包含该 oracle、且 `origin: oracle` 的所有 checkpoint。参与 checkpoint 的状态 SHALL 直接采用前置能力 `case-verify-evidence` 中由 `status.py` 计算出的当前状态，其中“有效观察”已排除被 supersede 和过期的观察。

汇总状态按以下顺序判断：
1. 参与集合为空：`uncovered`；
2. 任一参与 checkpoint 的状态为 fail：`fail`；
3. 每个参与 checkpoint 的状态都是 pass，并且每个都至少有一条带证据的 pass 有效观察：`pass`；
4. 其余情况，包括存在 pending 的 checkpoint：`partial`。

derived checkpoint 的观察 SHALL NOT 参与任何 oracle 的汇总。查看器 SHALL 在汇总状态旁显示“查看器计算值，不是验收结论”。

#### Scenario: 纠偏后通过
- **GIVEN** oracle O-1 只挂载了 checkpoint C1；C1 有一条 fail `obs-1`，以及一条 `supersedes: obs-1`、带截图的 pass
- **WHEN** 构建 catalog
- **THEN** O-1 的汇总状态为 `pass`

#### Scenario: 部分 checkpoint 尚未执行
- **GIVEN** O-1 挂载了 C1 和 C3；C1 有一条带证据的 pass，C3 没有任何观察
- **WHEN** 构建 catalog
- **THEN** O-1 的汇总为 `partial`

#### Scenario: 通过但无证据
- **GIVEN** oracle O-3 的有效观察全部为 pass，但都只有 `limits`，没有 evidence
- **WHEN** 构建 catalog
- **THEN** O-3 的汇总状态为 `partial`

#### Scenario: 未覆盖与派生不计入
- **GIVEN** oracle O-2 没有被任何 checkpoint 挂载；derived checkpoint C2 的 `oracle_ids` 包含 O-2，且 C2 为 pass
- **WHEN** 构建 catalog
- **THEN** O-2 的汇总状态为 `uncovered`；`gaps.derived_checkpoints` 中包含 C2

### Requirement: 两种视角浏览同一份数据
查看器 SHALL 提供两种视图，可以随时切换：
- **按 oracle**：每个条目显示 `title`、`expected`、关联的 checkpoint、各 checkpoint 的观察时间线和汇总状态；未覆盖的 oracle 显示“未覆盖”。
- **按 checkpoint**：每个条目显示关联的 oracle（点击可跳到按 oracle 视图中的该条目）、观察时间线（按 loop 分组，同一 loop 内按 env 并列）以及 derived 标记。

被 supersede 的观察 SHALL 仍显示在时间线上，并标注“已被 <obs_id> 纠偏”。Python 构建器 SHALL 为每条观察生成 `plan_rev` 和 `expired` 布尔标记（其 plan_rev 不等于当前 active_plan_rev 时为 true）；两种时间线均 SHALL 对 expired 记录显示“已过期，不计入当前状态”，不由前端重新计算有效性。

#### Scenario: 同内容重新确认后的历史展示
- **GIVEN** oracle checkpoint 与 derived checkpoint 都已有带证据的 pass/fail 观察
- **WHEN** 同内容重新确认计划且没有追加新观察，然后构建并展示 catalog
- **THEN** 全部当前 checkpoint（包括未改动项和 derived）为 pending；所有参与集合非空的 oracle 为 partial；旧观察仍可见，expired 为 true，两种时间线均显示过期标记

两种视图 SHALL 支持以下交互：
- 文本搜索，匹配范围为 id、title/description、expected、actual；
- 按汇总状态或当前状态筛选；
- 截图放大，按 Escape 关闭；
- hash 深链 `#oracle=<id>` 与 `#checkpoint=<id>`。深链指向不存在的 id 时，SHALL 显示“未找到”，而不是空白页。

catalog 中的所有文本 SHALL 以字面文本渲染，不得被当作 HTML 解析。

#### Scenario: 深链定位
- **GIVEN** 查看器已加载 fixture
- **WHEN** 打开 `/#checkpoint=C1`
- **THEN** 详情区显示 C1，其时间线中有 `obs-1` 和纠偏后的观察，`obs-1` 带纠偏标注

#### Scenario: 文本按字面渲染
- **GIVEN** 某个 oracle 的 `expected` 为 `<img src=x onerror=alert(1)>`
- **WHEN** 渲染该 oracle 的详情
- **THEN** 详情区该字段的 `textContent` 等于原字符串，且详情区内不存在 `img` 元素

#### Scenario: 不存在的深链
- **WHEN** 打开 `/#oracle=NOPE`
- **THEN** 详情区显示“未找到 NOPE”

### Requirement: 查看器服务只在本机提供 catalog 内的文件
服务 SHALL 只绑定 `127.0.0.1`。以下请求 SHALL 返回 403：
- `Host` 头不是 `127.0.0.1:<port>` 或 `localhost:<port>`；
- 带有 `Sec-Fetch-Site: cross-site`。

服务只开放以下路径：`/`、`/app.js`、`/logic.js`、`/style.css`、`/api/catalog`、`/health`，以及 `/asset/<key>`。`<key>` SHALL 只在构建 catalog 时生成的映射表中精确查找，SHALL NOT 拼接为文件路径。查不到的 key 以及其它任何路径，一律返回 404。

四个静态文件（`/`、`/app.js`、`/logic.js`、`/style.css`）SHALL 精确映射到 skill 目录下 `viewer/` 中的对应文件。对 `/asset/<key>`，返回文件前 SHALL 再做一次 realpath 校验，确认文件仍在 checking 目录内。允许下发的证据类型为 `screenshot`（png、jpg、jpeg、webp）和 `dom`（以 `text/plain` 下发）。`network` 和 `log` 类证据 SHALL NOT 生成 key。

所有响应 SHALL 带上 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`，以及限制为同源的 CSP（含 `frame-ancestors 'none'`）。

#### Scenario: 合法图片
- **GIVEN** catalog 中某张截图的 `url` 为 `/asset/<key>`
- **WHEN** 请求该 URL
- **THEN** 返回 200，`Content-Type` 为 `image/*`，响应体与文件字节一致

#### Scenario: 前端模块可加载
- **WHEN** 请求 `/logic.js`，以及请求 `/other.js`
- **THEN** 前者返回 200，`Content-Type` 为 `text/javascript`，响应体与 `viewer/logic.js` 字节一致；后者返回 404

#### Scenario: skill 目录与 checking 目录分离
- **GIVEN** checking 目录与 skill 目录位于两棵互不包含的目录树中
- **WHEN** 请求 `/`、`/app.js`、`/logic.js`、`/style.css`
- **THEN** 都返回 200

#### Scenario: 资产启动后被改指到根外
- **GIVEN** 服务启动后，catalog 中某张截图的文件被替换为指向 checking 目录外部的符号链接
- **WHEN** 请求该截图对应的 `/asset/<key>`
- **THEN** 返回 404，响应体中不含外部文件的字节

#### Scenario: 越权路径
- **WHEN** 请求 `/asset/../../etc/passwd`、`/asset/%2Fetc%2Fpasswd`、`/asset/0000`（不存在的 key），或者 `/server.py`
- **THEN** 都返回 404

#### Scenario: 非本机来源
- **WHEN** 以 `Host: evil.example` 或 `Sec-Fetch-Site: cross-site` 请求 `/api/catalog`
- **THEN** 返回 403

#### Scenario: 网络证据不下发
- **GIVEN** 一条观察引用了 `kind: network` 的证据 `evidence/C1/req.json`
- **WHEN** 构建 catalog 并请求 `/api/catalog`
- **THEN** 该证据的键集合恰好是 `{name, kind, scope, unavailable}`，且 `unavailable` 为 true，不含 `url`；服务也没有任何路径能读到该文件的内容
