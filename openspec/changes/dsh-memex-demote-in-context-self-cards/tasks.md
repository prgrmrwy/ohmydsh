## 1. 先写失败的测试

- [ ] 1.1 新建 `packages/dsh-memex/test/in-context.test.ts`，覆盖纯函数：登记与覆盖（同一 `(scope, slug)` 取最新锚点）、锚点在/不在可见节点集合中的判定、稳定分区（非在场在前，两部分保持原序）、按名取回不移动但仍标注、同名 slug 不同库互不影响、空登记或无可见上下文时原样返回。验证：在没有实现时这些用例失败。
- [ ] 1.2 在 `packages/dsh-memex/test/tools.test.ts` 新增用例：写入后 `memex_search` 把该卡移到末尾并带 `inContext` 字段；请求 10 条、前 10 条中有 2 张在场卡时，内核被请求 12 条，返回 10 条且前 8 条不是在场卡；其他会话写的卡不受影响；无登记时内核参数与返回 JSON 和改动前逐字节一致（与现有快照对比）。验证：新用例失败，既有用例通过。
- [ ] 1.3 同一文件为 `memex_recall` 新增用例：在场卡块整体移到末尾，标题行下插入标注行，卡片标题、摘要与 `Links` 行不变；stdout 无法分块时原样返回；无登记时 `content` 逐字节不变。验证：新用例失败。
- [ ] 1.4 在 `packages/dsh-memex/test/lifecycle-runtime.test.ts`（真实 `AgentLoop`/`SessionStore`）新增用例：写入后检索，该卡沉底；锚点的事件类型为 `assistant/message`；以 `replace` 替换掉写入所在范围后再检索，该卡恢复原位且无标注。验证：用例失败。
- [ ] 1.5 在 `packages/dsh-memex/test/telemetry.test.ts` 新增断言：被沉底的命中记录带 `demoted: true`，未沉底的命中不含该字段；`recall-report` 读取带新字段的记录不报错。验证：用例失败。

## 2. 实现

- [ ] 2.1 新增 `packages/dsh-memex/src/tools/in-context.ts`：登记（session 为键的 `WeakMap`）、判定（基于 `surface.nodes`）、重排（结构化命中与 recall 文本块两种形态）。不调用 `eventAt`/`snapshotEvents`。验证：1.1 通过。
- [ ] 2.2 在 `packages/dsh-memex/src/tools/index.ts` 接线：写入工具在执行开始时取锚点，主库与附加库写入成功后登记；`memex_search` 与 `memex_recall` 在有在场卡时多取并重排，无在场卡时走原路径。验证：1.2、1.3、1.4 通过，`tools.test.ts` 既有用例全部通过。
- [ ] 2.3 `packages/dsh-memex/src/telemetry/record.ts` 的 `HitRecord` 增加可选 `demoted`；`recordRecall` 传入重排后的命中与沉底标记。验证：1.5 通过，`telemetry.test.ts` 与 `recall-report.test.ts` 全部通过。
- [ ] 2.4 运行包内 `npm test`、`npm run typecheck`、`npm run build`、`npm run check:descriptions`。验证：退出码均为 0。

## 3. 版本、文档与部署

- [ ] 3.1 `packages/dsh-memex/package.json` 版本 0.3.0 → 0.3.1；`dsh.yaml` 中 dsh-memex 的 version 同步，note 追加本 change 的行为说明与回滚方式。验证：`npm run check:artifacts` 通过。
- [ ] 3.2 更新 `packages/dsh-memex/README.md` 与 `docs/notes/dsh-memex-integration.md`，说明在场自写卡的判定依据（`surface.nodes`、写入锚点）与不覆盖读取的边界；在 `docs/notes/dsh-plugin-integration-pitfalls.md` 记一条：工具执行时 `surface.nodes.at(-1)` 是发出调用的 assistant 消息，`eventAt`/`snapshotEvents` 已 deprecated。验证：两份文档含上述说明。
- [ ] 3.3 运行仓库级 `npm test`、`npm run check:artifacts`、`openspec validate dsh-memex-demote-in-context-self-cards --strict`。验证：退出码为 0（若存在与本变更无关的既有失败，记录基线对比）。
- [ ] 3.4 在用户确认 DSH 空闲后执行 `dsh build`、再跑一次确认幂等，并按 setsid 方式重启；在 Web GUI 实测：写一张卡后用相关词检索，该卡排在末尾并带标注；用该卡 slug 检索时保持原位。验证：在报告中描述观察结果（不提交截图）。
- [ ] 3.5 部署满一段时间后，用冻结的 rubric-v3 工具对改动后的新会话做同口径测量，与基线 `aggregate.json`（hash 见 `frozen-v3/MANIFEST.sha256`）对比，结果写入仓库外的评估目录。验证：对比报告存在，且说明样本量与区间。
