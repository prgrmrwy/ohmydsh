## 1. 查询分段纯函数

- [x] 1.1 新增 `packages/dsh-memex/src/tools/query-segment.ts`，导出单一纯函数（输入查询字符串，
      返回交给内核的查询字符串）；无 I/O、无状态、无外部依赖
- [x] 1.2 实现：按「连续汉字串 / 非汉字串」交替扫描；汉字串长度 >2 时切为重叠 2-gram，
      长度 ≤2 时原样保留；非汉字段 `trim` 后原样保留；各段以单个空格连接
- [x] 1.3 单测：纯 ASCII 输入**逐字节恒等**（含 `SettingsScope.mutate`、`connection.rpc.handle 405`、
      `pnpm file: hardlink`、`node:sqlite NUL`、`memex sync --init`、`AgentSetup unpublished agent`）
- [x] 1.4 单测：代码 token 在混合查询中保持完整（`settings mutate 值 类型`、`memex 中文 locale 报错`）
- [x] 1.5 单测：汉字切分正确（`子进程能不能用上代理` → 含 `子进 进程 … 代理` 的空格串）
- [x] 1.6 单测：边界输入（空串、纯空白、单字、双字、标点夹杂、全角标点）不抛错且结果稳定

## 2. 接入全部关键词检索入口

- [x] 2.1 `searchArgs()`（`src/tools/index.ts`）在 `args.semantic !== true` 时对 `args.query` 应用分段
- [x] 2.2 `memex_recall` 分支中内联的 `['search', …]` 调用应用**同一个**函数，不复制实现
- [x] 2.3 语义路径（`--semantic`）保持原样透传，不应用分段
- [x] 2.4 静态检查/测试：断言不存在「向内核发起关键词检索却未经分段」的调用点
- [x] 2.5 单测：同一含汉字查询经两个入口得到一致的内核参数形态

## 3. 回归与收益核对

- [x] 3.1 扩充 `test/tools.test.ts`：断言 `memex_search` 与 `memex_recall` 传给 runner 的参数
      在中文查询下含分段结果、在 ASCII 查询下与原查询一致
- [x] 3.2 记录已知取舍用例（`插件 RPC 调用返回 405 但没有日志` 名次由 1→2）为显式测试或注释，
      使后续修改能看见这个代价而不是无声改变
- [x] 3.3 仓内测试只用自造最小夹具，MUST NOT 引入任何真实卡片内容（用户私有数据不进版本控制）
- [x] 3.4 端到端收益用仓外 gold set 复核（`~/.dsh-memex/.eval/retrieval-eval.mjs`），
      记录 top1/top3 前后对比到本 change 的验收说明中

## 4. 工程校验

- [x] 4.1 `cd packages/dsh-memex && npm run typecheck`
- [x] 4.2 `cd packages/dsh-memex && npm test`
- [x] 4.3 仓库级 `npm test`
- [x] 4.4 `node scripts/sync.mjs` 并确认连续第二次运行无变化（幂等）
- [x] 4.5 `npm run check:artifacts`

## 5. 实机验收

- [x] 5.1 重启后在真实会话经 `memex_search` / `memex_recall` 验证：`子进程能不能用上代理` → rank 1 命中 `dsh-proxy-model-differs-by-seam`（变更前 0 结果）；`会话删不掉 提示被占用` 经 recall 入口同样命中（变更前 0 结果）
- [x] 5.2 `connection.rpc.handle 405` rank 1 命中 `dsh-015-connection-rpc-channel-silent-405`，无回归
- [x] 5.3 确认卡片文件与 frontmatter 未被任何检索行为改动（`git status` 0 处 modified）

## 6. 归档

- [x] 6.1 `openspec validate memex-cjk-query-segmentation`
- [x] 6.2 delta 的 2 条 Requirement / 9 个 Scenario 已合入 `openspec/specs/dsh-memex-integration/spec.md`（`openspec validate --specs` 通过）
