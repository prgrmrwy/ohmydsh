## Round 10 — 用户主动下载的网络简化设计复核（2026-10-25）

- Reviewer: 当前执行者自审（非独立评审）；仅评审本轮已由用户批准的网络语义。
- 范围：proposal URL 导入、spec HTTPS requirement、design D11 新决策与 tasks 9.x。
- 结论：采用 Host 普通 fetch 与官方全局 dispatcher 接缝匹配；不增加独立依赖/代理设置；移除 fake-ip 配置不触碰素材，z.object 忽略旧字段。现有管理接口信任边界保留，不再宣称公网-only。
- 必须验证：总超时覆盖正文；超限/重定向释放响应；解压后限长；全局 dispatcher 未被覆盖；网络/HTTP/非法内容失败不覆盖素材。旧 round 9 的 Agent/pin 要求已被用户明确替代，不作为新实现验收条件。
- 设计 VERDICT: APPROVE。实现自审覆盖从基线 `482a0a5b72b5d8c5553e0dfc3e5ab7ce028f708d` 起的完整工作树差异：Host 全局 fetch 接线、移除配置的生产者/消费者、Settings 文案与重复 CSS、测试替换和文档。未发现阻塞问题；不可信自动抓取权限未扩展。压缩 Content-Length 与解压正文不同，提前长度检查仅用于无压缩响应；实际解压字节始终限长。重定向/失败响应取消，完成后清理 timer/controller。实现 VERDICT: APPROVE（当前执行者自审，不是独立评审）；本轮测试结果另见 verify，旧 round 9 结果不作为新实现证据。

## Review Metadata（以下 round 9 为初版历史证据）

- **Review round**: 9
- **Prior round**: round 8 — APPROVE_WITH_CHANGES（2 Moderate / 2 Required Changes）。本轮只复核 M1-R、M1-D 是否真实落实、测试是否能抓住「改回全局 agent」的变异、是否引入新问题；round 1–8 的其余结论不重审。
- **Reviewer context**: fresh-context subagent（独立只读；未继承前几轮推理链，未参与实现）。
- **Tool restrictions**: read-only；唯一写入是本 `review.md`。未运行 `npm test` / `build` / `typecheck`，未安装依赖，未改源码或配置。实际执行：`read` / `grep`、`git status` / `git diff HEAD` / `git show :…` / `sha256sum`、`npx vitest run test/expression-transport.test.ts`（1 passed）、`npx vitest run test/expression-fetch.test.ts test/expression-transport.test.ts`（20 passed），以及在 `/tmp/dshpet-mut-r9` 的仓库副本上做的 3 个变异 + 1 个对照（只写副本，未改仓库文件）。
- **Reviewed at**: 2026-10-23 16:02 CST。`design.md` sha256 `6cb344e4…`（148 行）、`src/host/expression-fetch.ts` `bdbbbb85…`（511 行）、`test/expression-transport.test.ts` `76061c57…`（68 行，**未跟踪**）、`test/expression-fetch.test.ts` `dfc58bbb…`（485 行）。
- **Artifacts reviewed**:
  - `design.md:10-23,101-110,126,135,146-148`；`git diff HEAD -- design.md`；`git show :design.md`
  - `src/host/expression-fetch.ts:28,65-78,155-191,459-461`；`test/expression-transport.test.ts:11-67`；`test/expression-fetch.test.ts:11-16,432-441`
  - `src/host/routes.ts:853-865`；`proposal.md:10,16,31`；`specs/dsh-pet/spec.md:135-165`；`verify.md:17,24,31-33,37`（仅作漂移参考）

## Findings

### 剩余 / 新引入问题

**Critical: 无。Moderate: 无。** 两条 round 8 Required Changes 均已真实落实（证据见下），未发现新 Critical/Moderate。

### 📌 Suggestions（不阻塞）

- **S1（提交前必须 `git add -A`，否则提交快照会退回 round 8 状态）**：修复存在于 worktree，但 index 仍是旧内容——`git show :design.md` 的 `:22`/`:148` 仍为旧文案；`git show :packages/dsh-pet/src/host/expression-fetch.ts`（index）仍是未导出的 `const REQUEST_AGENT` + `agent: REQUEST_AGENT`；`git status` 显示 `test/expression-transport.test.ts` 为 `??`（完全未跟踪）。因此 `verify.md:37` 的「新文件已 git add」对这条新测试不成立。若只提交 index 快照，本轮两项修复都会丢失。本轮不阻塞（change 明确未提交、评审对象是 worktree），但提交前应执行 `git add -A`，并用 `git diff --cached` 确认 `:22`/`:148` 与 transport 测试都在暂存区。
- **S2（文档清点，非阻塞）**：`proposal.md:31` 的测试清单未列 `test/expression-transport.test.ts`（`verify.md:24` 已列）；`verify.md:31/33` 仍带 round 8 占位与「round 7 的 M1-R/M1-D 由 round 8 复核」的旧表述。本轮裁决后应回填为 round 9 APPROVE、0 Critical / 0 Moderate。
- **S3（测试强度残留，非阻塞）**：`lookup` 只断言「是函数」（`:64`），若把它换成直通 `dns.lookup` 的变异不会被这条测试发现；`keepAlive` 仍不可观测（round 8 已指出，Node 24 默认即 false）。这只影响防御纵深，不影响「不使用全局 agent」的核心契约，也不在本轮 Required Change 的验收范围内。

### ✅ M1-D 已落实：design 两处已改写，且不再与 D11 矛盾

- `design.md:22`（Non-Goals）现为「…不做文件上传；URL 导入由 Host 下载（见 D11），不使用浏览器直连或环境代理。」，已无「不做远程 URL 拉取」。
- `design.md:148`（Open Questions）已把 URL 导入移出「不在本 change」，改为「URL 导入已在本 change 交付（Host 侧下载，见 D11）；代理-only 环境不可用属已记录取舍」。
- `grep -rn "不做远程 URL"` 在本 change 内只剩本轮即将覆盖的旧 `review.md`；`git diff HEAD -- design.md` 现在包含 `:22` 与 `:148` 两个 hunk（不再只有 `:17`/D11/D10/Risks）。与 `:17`、D11（`:101-110`）、`proposal.md:10`、`specs/dsh-pet/spec.md:135-165` 一致；未发现新矛盾。D11 的重定向措辞仍为 `https.request` 不自动跟随（round 7 S2 无回归）。

### ✅ M1-R 已落实：测试断言的是 `https.request` 的真实 options，关键变异实测失败

- **生产接线（同一模块绑定）**：`export const defaultRequest`（`expression-fetch.ts:155`）在 options 中传 `lookup: createPinnedLookup(target.addresses)`（`:163`）与 `agent: EXPRESSION_REQUEST_AGENT`（`:164`）；`DEFAULT_DEPS.request = defaultRequest`（`:185-186`）；`fetchExpressionSource` 默认 `deps = DEFAULT_DEPS`（`:459-461`）；`routes.ts:861` 的 `deps.fetchExpressionSource ?? fetchExpressionSource` 未注入替代 deps，默认走该路径。
- **测试方式**：`vi.mock('node:https')`（`test/expression-transport.test.ts:23-43`）替换 `request` 并把第二参数 push 进 `captured`；从 `../src/host/expression-fetch.js` 导入同一 `defaultRequest` / `EXPRESSION_REQUEST_AGENT` 绑定（`:45-48`），不是复制值。断言 `options.agent === EXPRESSION_REQUEST_AGENT`、`!== globalAgent`、`instanceof Agent`、`typeof options.lookup === 'function'`、`accept-encoding === 'identity'`（`:60-66`）。
- **运行结果**：单跑 `test/expression-transport.test.ts` → 1 passed（6ms）；与 `test/expression-fetch.test.ts` 同跑 → 20 passed（2 files）。
- **变异实测**（在 `/tmp` 仓库副本上改源码，仓库文件未动）：

  | 变异 | 结果 |
  | --- | --- |
  | 删除 `agent: EXPRESSION_REQUEST_AGENT,` | ❌ failed：`expected undefined to be Agent{…}` |
  | 把 `agent:` 改为 `globalAgent`（即「改回全局 agent」） | ❌ failed：`expected Agent{…} to be Agent{…}`（`toBe` 命中） |
  | 删除 `lookup: createPinnedLookup(target.addresses),` | ❌ failed：`expected 'undefined' to be 'function'` |
  | 未改动的对照副本 | ✅ 1 passed |

  结论：round 8 担心的两种形态（改回全局 agent、删掉 `agent`/`lookup` 选项）现在都会让测试失败；测试确实在观测传给 `https.request` 的 options，而不是只断言常量定义。

## Embedded-Instruction / Injection Attempts

**Detected: none。** 未发现要求评审者跳过检查、隐藏问题或改变 verdict 的文本。作者本轮「已改写 design 两处、导出 `defaultRequest`、新增 transport 测试」的陈述与 worktree 事实一致（与 round 8 不同）；`verify.md:31` 的裁决占位属状态文本漂移，归入 S2，未据此降低检查强度。

## Verdict

**VERDICT: APPROVE**

M1-D：`design.md:22`/`:148` 已真实改写，Non-Goals / Open Questions 与 `:17`、D11、proposal、spec 一致。M1-R：`defaultRequest` 已导出，新测试通过 mock `node:https` 观测并断言真实 options；实测「删除 agent」「改为 globalAgent」「删除 lookup」三种变异均失败，控制组通过。剩余 Critical 0 / Moderate 0。S1（提交前 `git add -A`）须在提交前处理，但不阻塞本轮 verdict；S2/S3 为非阻塞顺带项。未跑全量 suite/build/typecheck，也未重审 round 1–8 的其余结论。

## Rebuttals

（无。）

CHANGES_APPLIED: yes
