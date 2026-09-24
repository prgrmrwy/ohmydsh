## 1. 遥测记录的形状与纯函数

- [x] 1.1 新增 `src/telemetry/record.ts`：定义一条记录的字段（时间、scope、返回条数、
      每条的 slug 与是否有锚点、查询形态特征），MUST NOT 含查询原文或卡片正文
- [x] 1.2 实现 `anchored(queryTokens, slug, title)`：ASCII 按 `[-_/\s]` 切段整段比较，
      汉字按子串；纯函数、无 I/O
- [x] 1.3 实现 `queryShape(query)`：只产出 token 数、是否含汉字、是否经过分段，
      MUST NOT 保留任何原文片段
- [x] 1.4 单测：`anchored` 对 `proxy`/`hardlink`/`会话 归档` 为真，对噪声 bigram `不能` 为假
- [x] 1.5 单测：记录对象里不出现查询原文（用一个含独特标记串的查询断言其不泄漏）

## 2. 落盘：库外、NDJSON、尽力而为

- [x] 2.1 新增 `src/telemetry/sink.ts`：解析 `$DSH_HOME/plugins/dsh-memex/`，
      按 `recall-<YYYY-MM>.ndjson` 追加
- [x] 2.2 目录以 owner-only 权限创建（与 dsh-pet 的 `0o700` 惯例一致）
- [x] 2.3 所有写入路径吞掉异常；首次失败经 logger 提示一次，之后静默（不刷屏）
- [x] 2.4 单测：目标不可写时不抛错
- [x] 2.5 单测：写入内容是合法 NDJSON，逐行可独立解析

## 3. 接入两个关键词检索入口

- [x] 3.1 `memex_search` 在返回前记录一条
- [x] 3.2 `memex_recall` 的 search 分支在返回前记录一条
- [x] 3.3 语义检索路径同样记录（形态标记为 semantic），但 MUST NOT 记录原文
- [x] 3.4 `--list` / `index` 这类无查询的路径不记录
- [x] 3.5 记账点必须在 `currentFor()` 的关闭记忆拒绝路径**之后**，确保关闭记忆的工作区零记录
- [x] 3.6 单测：检索结果在遥测可用与不可用时逐字节相同
- [x] 3.7 单测：关闭记忆的工作区不产生记录

## 4. 分析脚本（仓外，不进版本控制）

- [x] 4.1 在 `~/.dsh-memex/.eval/` 下新增读取脚本：从 NDJSON 汇总
      「从未被召回的卡」「空结果率」「无锚点命中占比」
- [x] 4.2 脚本对损坏行跳过而非报错（追加写可能截断最后一行）

## 5. 工程校验

- [x] 5.1 `cd packages/dsh-memex && npm run typecheck`
- [x] 5.2 `cd packages/dsh-memex && npm test`
- [x] 5.3 仓库级 `npm test`
- [x] 5.4 `node scripts/sync.mjs` 连续两次，第二次无变化
- [x] 5.5 `npm run check:artifacts`

## 6. 实机验收

- [x] 6.1 重启后经真实会话 3 次检索，NDJSON 正确写出（含 2 次空结果与 anchored 判定）
- [x] 6.2 各库 `git status` 0 处 modified、无遥测产物
- [x] 6.3 grep 四个查询词在日志中均 0 命中
- [x] 6.4 首份基线：personal 112/116 未被召回；中文查询空结果率 2/3

## 7. 归档

- [x] 7.1 `openspec validate memex-recall-telemetry --strict`
- [x] 7.2 delta 的 3 条 Requirement / 7 个 Scenario 已合入 `openspec/specs/dsh-memex-memory/spec.md`

## 8. 实机验收暴露并修复的两个缺陷

- [x] 8.1 **遥测按调用方 scope 归属，跨库检索会归错库**：fan-out 时命中卡常属于别的库，
      按调用方记会把其它库的活卡误报成死卡。改为每条命中携带自身 `scope`（`hit.scope`），
      记录级 `scope` 仅表示「从哪里发起」；补 fan-out 归属测试
- [x] 8.2 **单元测试污染真实遥测日志**：`tools.test.ts` 与 `acceptance.test.ts` 未隔离
      `DSH_HOME`，把 52 条夹具写进了开发者本人的 recall 日志并污染统计。两个套件加
      `beforeEach` 重定向到临时 home；实测全量测试前后真实日志行数不变
- [x] 8.3 分析脚本对缺 `hit.scope` 的历史记录诚实降级（计入「已被召回」但不归属某库，
      并在报告中显式标注条数），而不是回退到调用方 scope 得出错误结论
