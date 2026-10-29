# Tasks

## 1. 会话日志解码能力

- [x] 1.1 新增 `scripts/lib/session-log.mjs`：按 zstd magic（`28 B5 2F FD`）切帧并逐帧解压后合并，导出可被 readiness 与 recorder 复用的解码函数。验证：对真实 `session.v4.jsonl.zstd` 解码得到与逐帧切分一致的完整字节数（本机样例 4312023 字节 / 418 帧），且对单帧文件仍正确。
- [x] 1.2 在 `scripts/lib/session-log.mjs` 中实现「多帧只解首帧」的回归护栏：若整缓冲快速路径返回的字节数小于逐帧合并结果，以逐帧结果为准。验证：新增单测断言整缓冲 API 只返回首帧时输出仍为完整内容。
- [x] 1.3 让解码失败返回结构化原因（文件缺失 / 解压失败 / 无 `request/header` 事件），不抛裸异常。验证：单测覆盖三类原因各自可区分。

## 2. 就绪探针修复

- [x] 2.1 改 `scripts/jev-readiness.mjs` 使用 `scripts/lib/session-log.mjs`，删除对 `spawnSync('zstd', ...)` 的依赖，保留 v4→v3 回退顺序。验证：在本机（无 zstd CLI）运行 `node scripts/jev-readiness.mjs` 输出 `currentSession.available: true` 且 `liveProbeReady: true`。
- [x] 2.2 让 `currentSession` 报告可操作失败原因，替换笼统的 `decodeFailed` 布尔。验证：单测断言三类失败各有不同原因字段且退出码为 0。
- [x] 2.3 重写 `tests/jev-readiness.test.mjs` 的 fixture，用 `scripts/lib/session-log.mjs` 的编码路径或内置 zlib 生成多帧日志，不再 `spawnSync('zstd')`。验证：`node --test tests/jev-readiness.test.mjs` 全部通过（当前有 1 个用例失败）。

## 3. 延迟测量口径

- [x] 3.1 改 `skills/jev-workflow-router/SKILL.md`：删除「两次 `node -e Date.now()` 取差」的规定，改为记录 observation 的调用时间窗并声明由 recorder 回填延迟。验证：`node --test tests/jev-workflow-router.test.mjs` 中关于计时措辞的断言按新文本更新并通过。
- [x] 3.2 在 `recorder.mjs` 新增 `latency <observationId>` 子命令：按 `DSH_SESSION_ID` 定位日志，按 `callId` 配对 `tool/call`/`tool/result`，求和后回填该记录。验证：单测用合成多帧日志断言回填值与 `call→result` 之差一致。
- [x] 3.3 `latency` 在缺少 `DSH_SESSION_ID`、日志不可解码、或找不到配对时，写 `availability: unavailable` 与具体原因并以可区分方式退出，不写猜测值。验证：单测覆盖三种不可用分支。
- [x] 3.4 修 `normalizeLatency` 的静默截断：保留实测值并加显式 `truncated` 标记，不再压到 60000。验证：单测断言 80057ms 存储与报告均为 80057ms。

## 4. 报告指标改造

- [x] 4.1 报告新增「建议与实际路径不一致率」，与既有失败率、延迟 p50/p95 并列。验证：单测用 10 条记录（1 条失败、2 条不一致）断言失败率 0.1、不一致率 0.2。
- [x] 4.2 删除 100 条样本、10 个工作日、每条路线 15 条、每类高危 10 条覆盖门槛及 `phase2Admission=not-established` 汇总语义，零样本时三项指标标「样本不足」。验证：单测断言空记录文件下报告含三项指标且不含被删门槛字段。
- [x] 4.3 更新 `_note`/字段说明使报告自解释，并在 `skills/jev-workflow-router/SKILL.md` 的 recorder 用法段同步新子命令。验证：`node skills/jev-workflow-router/recorder.mjs report` 的输出可读且不含已删字段。

## 5. advisory 行为与接线

- [x] 5.1 改 `skills/jev-workflow-router/SKILL.md` 为 advisory 语义：一行中文建议 + 置信度 + 可无视；用户显式指定或既有 change 时零调用直接跳过；低置信度/失败静默。验证：`node --test tests/jev-workflow-router.test.mjs tests/jev-workflow-routing-fixtures.test.mjs` 全部通过，且 SKILL 文本断言覆盖「零调用跳过」。
- [x] 5.2 在 `instructions/dsh-home.md` 增加一条明确的触发规则，使决策点不再依赖 agent 偶然想起。验证：`node scripts/sync.mjs` 后 `~/.dsh/AGENTS.md` 含该规则且连续运行第二次无变化（幂等）。
- [x] 5.3 更新 `dsh.yaml` 中 `jev-workflow-router` 的 `brief`/`note` 为 advisory 语义，并移除「只做 shadow observation」的表述。验证：`node scripts/sync.mjs` 成功，且 `manifest` 校验通过（`npm test` 中 manifest 相关用例）。
- [x] 5.4 更新 `README.zh.md` 中该 skill 的描述行。验证：描述与 SKILL 的 description 语义一致，无「仅观察」残留。

## 6. 集成验证

- [x] 6.1 跑 `npm test` 与 `npm run check:artifacts`，确认无新增失败、产物策略合规。
- [x] 6.2 `dsh build` 连续两次，确认第二次无变更（幂等）；部署副本与仓库逐字节一致。（重启 Host 后的真实决策点观察交由用户在下一会话确认。）
- [x] 6.3 已用真实会话日志端到端验证 `record` → `latency` → `report` 链路：真实 classify 往返回填 1693ms/1698ms（自我计时口径同场景为 32095ms），低置信度正确降为 `needs-review`；验证记录标为 `synthetic-fixture` 后清除，未污染 real-vibe 指标。真实 `real-vibe` 记录将由重启后的日常使用产生。

## Workflow follow-up

- 归档前确认 `openspec/specs/jev-workflow-routing` 与 `jev-provider-transport` 已同步本 change 的 delta。
- 若 6.2 显示触发率仍为 0，在 `BACKLOG.md` 记录「advisory 未触发需评估插件化」，不阻塞归档。
- 归档后把 `openspec/changes/archive/2026-09-25-make-jev-shadow-gates-measurable/checking/phase-2-gate.md` 之外的覆盖门槛结论标注为历史。
