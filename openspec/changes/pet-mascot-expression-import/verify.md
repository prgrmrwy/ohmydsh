## 0.2.15 — 用户主动下载沿用 Host 网络（2026-10-25）

- 本轮需求：去除功能级 DNS/IP 拦截、地址钉扎、专用直连 Agent 与 fake-ip 配置；使用 Host 全局 fetch，保留 TLS、10s 总截止、3 跳重定向、解压后 512 KiB 上限和共享素材校验。
- RED：`npx vitest run test/expression-fetch.test.ts -t 'uses Host fetch'` 在旧实现下因 localhost 被主动拒绝而失败（不是导入/语法错误）。
- 全量：`cd packages/dsh-pet && npm run typecheck && npm test` → 类型通过；204 passed / 3 skipped files，3447 passed / 8 skipped tests，0 failed（143.06s）。移除的是被本轮需求替代的公网/地址 pin 测试，不是绕过仍有效的安全契约。
- 最终小幅调整（压缩 Content-Length 不代表解压后长度、清理取消异常、显式 never return）后：`npm run typecheck && npx vitest run test/expression-fetch.test.ts test/expression-transport.test.ts test/expression-routes.test.ts test/client.test.ts` → 4 files / 185 tests passed。
- root `npm test` → 447 tests，445 passed / 2 skipped / 0 failed；`npm run check:artifacts` → passed；`openspec validate pet-mascot-expression-import --strict` → passed（初次因 requirement 超长告警，精简文字并移到场景后通过）。
- Host transport：真实 Node fetch + undici MockAgent 全局 dispatcher，目标 `.invalid:8443` 仍能下载（不进行 Pet 预解析）；gzip 正常解压，压缩小文件解压超过上限被拒；无自定义 dispatcher/Agent、无 Cookie/Authorization，跨重定向/正文共用截止信号。现有路由失败不覆盖测试通过。
- review round 10：当前执行者完整差异自审 APPROVE，非独立评审；旧 round 9 对公网/pin 的裁决为历史证据，不再适用于新策略。
- 部署：`node scripts/sync.mjs` exit 0，物化 0.2.15；第二次 sync 无变化。部署的 `lib/host/expression-fetch.js`、`lib/client.js` 与本轮构建 SHA-256 一致；没有手改部署副本。GUI `http://127.0.0.1:3080/` 未认证探针返回 401，仅证明服务可达；不擅自重启 Host。既有 7.6 浏览器/真机验收仍开放，未经用户机器 fake-ip/TUN 实测，不宣称特定网络必然可达。

## Verification Results（以下为初版历史记录，不作为 0.2.15 当前证据）

### Task Completion
- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: 7.6（实机验收：`dsh build` 已完成并部署 dsh-pet 0.2.0；等待所有者批准重启 DSH 后做导入/移除/回退/无刷新生效验收）

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test（33 个场景全部有同名测试；`test/expression.test.ts`、`test/expression-routes.test.ts`、`test/mascot-expression.test.ts`、`test/mascot-expression-dom.test.ts`、`test/expression-packaging.test.ts`、`test/client.test.ts`）
- [x] Every test-plan.md row flipped to 🟢 green (no row left 🔴 red)
- [x] Full suite passes
- [ ] Zero skipped/pending/commented-out tests —— 全量 suite 有 8 个 skip，均为本 change 之前既存的用例/排除项（`test/inquiry-*` 等，见 `vitest.config.ts` 的 exclude 与其自身 skip），本 change 未新增 skip、未弱化或删除测试
- [x] No test weakened or deleted without REMOVED requirement

### Evidence

- Final full-suite command: `cd packages/dsh-pet && npm test`（`pretest` 先跑 `npm run build`）
- Result summary: **202 passed | 3 skipped test files；3430 passed | 8 skipped tests；0 failed**（duration 109.35s；含 URL 导入增量与 round 8 修复）
- Typecheck: `cd packages/dsh-pet && npm run typecheck` → exit 0（host + client 两个 tsconfig）
- 仓库级：`npm test`（root, node:test）→ 447 tests, **445 pass / 2 skip / 0 fail**；`npm run check:artifacts` → tracked paths comply
- OpenSpec: `./node_modules/.bin/openspec validate pet-mascot-expression-import --strict` → `Change 'pet-mascot-expression-import' is valid`，exit 0
- 发布物：`npm pack --dry-run` 包含 `THIRD-PARTY-NOTICES.md`（1.6kB）；`package.json#files` 含该文件与 `lib`
- Bundle 体积：`lib/client.js` 由 343,072 B raw / 86,013 B gzip（变更前）增至 590,112 B raw / 145,041 B gzip（变更后），即 **+247,040 B raw / +59,028 B gzip**；其中含 lottie-web light（上游 min 文件 168,394 B raw）与本特性代码
- URL 导入真机探针（一次性，未入库，**round-6 修复后重跑**）：`env -u NODE_USE_ENV_PROXY -u HTTP(S)_PROXY` 下用生产实现直连 `https://fonts.gstatic.com/s/e/notoemoji/latest/1f914/lottie.json` → **68,027 B 下载成功**并通过 `validateLottieSource`；同一构建对 `https://[::ffff:7f00:1]/…` 与 `https://[::ffff:a9fe:a9fe]/…` 返回 `INVALID_REQUEST`（C1 lookup 形状、C2 mapped IPv6 均修复）。注：URL 导入刻意不走环境代理，代理-only 环境会得到 `EXPRESSION_FETCH_FAILED`
- URL 导入增量：新增 `test/expression-fetch.test.ts`（19 用例：地址分类、URL 形状、SSRF、地址 pin、重定向、DNS、下载失败/大小/流中断）、`test/expression-transport.test.ts`（mock `node:https` 断言 `defaultRequest` 使用专用 agent 与 pinned lookup）与 `test/expression-routes.test.ts` 的 5 条 URL 路由用例；`test/client.test.ts` 断言设置页出现「从 URL 导入」；`openspec validate --strict` 通过（39 场景 / 39 test-plan 行）
- 真实素材/渲染探针（一次性，未入库）：Google Noto Animated Emoji `1f914/lottie.json`（68,027 B）通过 `validateLottieSource`；用 jsdom + 最小 canvas shim 加载真实 `lottie_light.min.js` 渲染该文件，结果 `isLoaded: true`、生成 `<svg>` 且含可绘制 `<path>`（drawable: true，nodes: 76），证明 Host 校验、真实素材与 light 播放器链路可用
- 部署：`node scripts/sync.mjs` 完成，`~/.dsh/profiles/web/node_modules/dsh-pet` 已是 **0.2.1**（含 `lib/host/expression-fetch.js`）；round-6 修复后再次物化，包含 `lib/client.js`（590,112 B）、`lib/host/expression.js`、`THIRD-PARTY-NOTICES.md`；实机验收待重启（见 7.6）
- Sync 附带失败（与本 change 无关，属既有环境）：`@michengai/dsh-btw` 指向 macOS 本地 tarball `/Users/prgrmrwy/.dsh/managed-assets/btw-cache-probe/...tgz`，本机不存在；本 change 未改该条目
- TDD 记录：新增模块的测试在实现落地前先行创建（首次运行出现 module-not-found / 断言失败），随后实现转绿；本轮未逐行留存失败输出，只有最终全绿证据

### Review Integrity
- [x] review.md 最新 verdict 为 round 9 `VERDICT: APPROVE`（0 Critical / 0 Moderate），`CHANGES_APPLIED: yes`；round 1–5 基础改动由 round 5 APPROVE 复核；round 6 的 C1/C2/M1/M2 由 round 7 复核；round 7/8 的 M1-R/M1-D 由 round 9 复核并通过（0 Critical / 0 Moderate），`CHANGES_APPLIED: yes`
- [x] Verdict not stale: proposal.md、design.md、specs/ 在 round 9 verdict 后未再修改（除应用 Required Changes 与数字回填）
- [x] All findings fixed or rebutted; round 1–5 的 Required Changes 由 round 5 复核，round 6 的 C1/C2/M1/M2 由 round 7 复核，round 7 的 M1-R/M1-D 由 round 8 复核

### Change Delivery

- OR delivery state: 未提交，工作树包含全部实现/测试/文档与 OpenSpec change；新文件已 `git add`（仓库 docs 链接检查要求 tracked path）。所有者可在重启验收后自行提交。
- 未提交 commit（符合 anvil verify 的“committing is NOT required”）。

## Overall Decision

DECISION: PASS_WITH_WARNINGS
