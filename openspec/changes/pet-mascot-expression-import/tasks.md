## 1. Host wire 契约与路径

- [x] 1.1 写失败测试：`expression-routes` 断言三条路由已注册、`INVALID_EXPRESSION` 映射 400（先在 `test/expression-routes.test.ts` 建骨架并跑红）
- [x] 1.2 实现：`wire.ts` 增加 `EXPRESSION_ROUTES`、`MAX_EXPRESSION_REQUEST_BODY_BYTES=4 MiB`、`MAX_EXPRESSION_SOURCE_BYTES=512 KiB`、层数/尺寸/深度常量、`PetExpressionView` 联合类型、`PetErrorCode` 加 `INVALID_EXPRESSION`
- [x] 1.3 实现：`errors.ts` 的 `statusOf` 把 `INVALID_EXPRESSION` 映射 400；`paths.ts` 增加 `expressionsRoot` 并纳入 `ensurePetDirectories`；更新 `test/paths.test.ts`
- [x] 1.4 重构：常量与类型集中在 wire，其他模块只引用；跑相关测试保持绿

## 2. Host 校验与单文件存储（R1/R2 纯逻辑）

- [x] 2.1 写失败测试：`test/expression.test.ts` 的 `saves the source and reads it back verbatim`、`reads none when no expression exists`
- [x] 2.2 实现：`src/host/expression.ts` 的 `saveExpression`（唯一临时名 + rename + 清理）与 `readExpression`（stat 限长 → 读取 → 校验 → none/ok/corrupt）通过 2.1
- [x] 2.3 写失败测试：`removes to a backup and stays idempotent`、`replaces the active source without creating a backup`
- [x] 2.4 实现：`removeExpression`（rename 到 `.removed`、ENOENT 幂等、Windows 目标占用兜底）与覆盖导入语义通过 2.3
- [x] 2.5 写失败测试：`rejects remote, protocol-relative, relative and non-string asset references`、`allows only embedded bitmap data URIs`
- [x] 2.6 实现：`validateLottieSource` 的基础结构校验与 `assets[].p/u` 白名单（非字符串拒绝、`data:image/` 大小写不敏感、拒绝 `data:image/svg+xml`）通过 2.5
- [x] 2.7 写失败测试：`rejects remote fonts and unsafe font families`、`rejects precomp reference chains deeper than the cap`、`expands refId precomps and rejects cycles or exponential blowup`、`resolves refId by layer type and rejects type mismatches`、`counts nested precomp layers and dimensions recursively`
- [x] 2.8 实现：`fonts` 校验；按 `assets[].id → layer.refId` 建渲染图，memo 展开层数≤80、引用深度≤32、拒绝环与未知引用、嵌套 `w/h`≤2048，通过 2.7
- [x] 2.9 写失败测试：`reports corrupt instead of throwing for broken or oversized files`
- [x] 2.10 实现：读取路径复用校验、损坏/超限返回 `corrupt` + 诊断，不抛 500；跑 2.x 全绿

## 3. Host 管理路由（R2）

- [x] 3.1 写失败测试：`keeps the current expression when validation fails`、`accepts the transport limit but rejects the oversized source`
- [x] 3.2 实现：`routes.ts` 的 view/import/remove 三条 `petRoute`，导入走 `validateLottieSource` 后再落盘，失败保持现状
- [x] 3.3 实现：`http.ts` 的 `petRoute(path, handler, { bodyLimit })` 与 `readJsonBody(req, limit)`；只有 import 传 4 MiB
- [x] 3.4 写失败测试：`rejects request bodies over 4 MiB with INVALID_REQUEST`、`keeps the 256 KiB limit for every other route`
- [x] 3.5 实现：超限错误映射 `INVALID_REQUEST`；确认其余路由默认上限回归通过
- [x] 3.6 写失败测试：路由 `data` 中 `content` 字符串在含 `token`/`secret` 键名与 >64 层嵌套时不被改写（数据完整性）
- [x] 3.7 实现：读取返回字符串而非解析对象，验证 `redactSecrets` 不触碰；`test/route-validation.test.ts` 的路由注册断言纳入 `EXPRESSION_ROUTES`

## 4. 客户端渲染、回退与播放策略（R3）

- [x] 4.1 写失败测试：`prefers a valid animation over the glyph`、`never plays under reduced motion or while hidden`
- [x] 4.2 实现：`src/client/mascot-expression.ts` 的 `resolveMascotFace`、`resolvePlayback`、`PlaybackGate`、`createLatestOnly` 纯逻辑通过 4.1
- [x] 4.3 写失败测试：`falls back and publishes a diagnostic when the player fails`（fake player 的 `error` 事件、`DOMLoaded` 后空容器/空 shape 层、坏图片三种 fixture）
- [x] 4.4 实现：可注入的 `createMascotAnimation`（事件 + `DOMLoaded` 后 rAF 有界检查、`isLoaded` 不作唯一判据、排除 `g`/`defs` 等容器）、`mascot-diagnostics.ts` 共享诊断 store + `PET_EXPRESSION_EVENT` 广播，通过 4.3
- [x] 4.5 实现：`overlay.tsx` 挂载动画容器、失败回退 glyph、`destroy` 与监听清理、`createLatestOnly` 请求序号防迟到；补充 `aria-hidden`、`pointer-events:none`
- [x] 4.6 写失败测试：`test/mascot-expression-dom.test.ts` 的 `refreshes the mascot on appearance broadcast without reload`（jsdom + 通过 prop 注入 fake loader，不 mock 真实模块）
- [x] 4.7 实现：overlay 响应 `PET_APPEARANCE_EVENT` 重新读取 expression，通过 4.6
- [x] 4.8 写失败测试：`test/mascot-expression.test.ts` 的 `ignores stale reads so a late response cannot resurrect an expression`
- [x] 4.9 实现：`createLatestOnly` 接入 overlay 的 `load()`，通过 4.8

## 5. 客户端 Settings 与样式

- [x] 5.1 写失败测试：Settings 外观页在 SSR 下渲染「动画表情」区块、导入提示与只接受 Lottie JSON 的说明（`test/client.test.ts` 静态标记断言）
- [x] 5.2 实现：`settings.tsx` 外观区块（当前状态/textarea/导入/复制导出/移除/诊断展示；已有动画时覆盖前 `confirm`）
- [x] 5.3 实现：导入或移除成功后 dispatch `PET_APPEARANCE_EVENT` 与 `PET_EXPRESSION_EVENT`；导出用 `navigator.clipboard.writeText` 并给出复制结果
- [x] 5.4 实现：`styles.ts` 增加 `.dshpet-lottie`、`.dshpet-textarea`、诊断/操作行样式；`test/client.test.ts` 的样式契约同步
- [x] 5.5 修正既有文案：外观页「保存在本浏览器中」与实际 Host 持久化不符，改为如实描述

## 6. 依赖、许可与发布物（R4）

- [x] 6.1 写失败测试：`test/expression-packaging.test.ts` 的 `ships the player notice in package files`、`bundles no animation assets`
- [x] 6.2 实现：新增 `THIRD-PARTY-NOTICES.md`（lottie-web 5.13.0 MIT 全文），加入 `package.json#files`；确认仓库无内置 `.lottie.json` 素材
- [x] 6.3 实现：`package.json` devDependency `lottie-web@5.13.0`（已安装）与本地 `lottie_light.min.js` 的 `.d.ts` 声明；真实播放器放在 `src/client/player.ts` 且只由浏览器入口导入；`vitest.config.ts` alias 到 `test/fixtures/lottie-stub.ts`；`npm install` 更新 `package-lock.json`
- [x] 6.4 写失败测试：导入/移除/读取路由在非 loopback Host 下被拒绝（继承 `petRoute` 信任边界）
- [x] 6.5 实现：确认新路由沿用 `petRoute` 同源校验；测试记录该语义

## 7. 版本、文档与验证

- [x] 7.1 更新 `packages/dsh-pet/package.json` 版本 0.2.0；`dsh.yaml` dsh-pet 条目版本与 note（状态目录、无 schema 变更、lottie-web MIT）
- [x] 7.2 更新 `packages/dsh-pet/README.md` 与 `README.zh.md`（仓库文档，`README.zh.md` 非发布物）：导入流程、支持格式（仅 Lottie JSON）、上限、存储路径、许可与用户素材责任
- [x] 7.3 运行 `npm run typecheck`、`npm test`（含 pretest build），记录通过数
- [x] 7.4 构建后复测 client bundle 增量为 +约 168 KiB raw / +47 KiB gzip，并把数字写入 `verify.md` 与 design 的实测记录
- [x] 7.5 `npm pack --dry-run` 证明 `THIRD-PARTY-NOTICES.md` 进入 tarball；`openspec validate pet-mascot-expression-import --strict` 退出 0
- [ ] 7.6 `dsh build` 物化到 `~/.dsh`；与所有者确认后重启 DSH，实机验收导入/移除/回退/无刷新生效

## 8. 从 HTTPS URL 导入

- [x] 8.1 写失败测试：`test/expression-fetch.test.ts` 的 URL 形状、SSRF、重定向、下载失败与体积上限用例（断言先红）
- [x] 8.2 实现：`src/host/expression-fetch.ts`（https/默认端口/凭据拒绝、私有与保留地址、DNS 全量校验、≤3 跳重定向逐跳复验、10s 超时、512 KiB、content-type 白名单）；`wire.ts` 增加路由与 `EXPRESSION_FETCH_FAILED`，`errors.ts` 映射 502
- [x] 8.3 写失败测试：`test/expression-routes.test.ts` 的 URL 路由用例（成功、非 https 拒绝、下载失败 502、下载内容非法保持现状）
- [x] 8.4 实现：`routes.ts` 增加 `expression-import-url` 路由与 `RouteDeps.fetchExpressionSource` 注入点，下载后复用 `saveExpression`
- [x] 8.5 写失败测试：`test/client.test.ts` 断言设置页出现「从 URL 导入」与 Host 下载说明
- [x] 8.6 实现：`client/api.ts` 增加 `importExpressionFromUrl`；`settings.tsx` 增加 URL 输入与按钮、复用覆盖确认/即时生效广播
- [x] 8.7 文档与版本：README 双语补充 URL 导入与安全边界；dsh-pet 0.2.0 → 0.2.1（`package.json` + `dsh.yaml`）
