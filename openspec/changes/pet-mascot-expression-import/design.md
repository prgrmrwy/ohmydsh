## Context

- Pet 的吉祥物是 Web 半区里一个独立 React root 中的圆形按钮（`src/client/overlay.tsx`），内容来自 Host 配置的单个 glyph 字符串（默认 🐾，`src/client/accent.ts`）；Settings 是另一个独立 React root，两者通过 `PET_APPEARANCE_EVENT` / `PET_ACCENT_EVENT` 广播同步。
- 外观目前持久化在 Pet 的 SQLite global 配置（`src/host/spec.ts` 的 `appearance` 字段）；`config` 路由只投影非敏感值，`config-update` 用 `strictBody` 白名单校验。
- 管理面 HTTP 由 `petRoute` 统一包装（`src/host/http.ts`）：同源 loopback 校验 → `readJsonBody`（全局上限 `MAX_REQUEST_BODY_BYTES = 256 KiB`）→ 成功响应经 `redactSecrets` 递归脱敏（深度上限 64、键名匹配 `token|secret|password|…`）→ `sendJson` 固定 `no-store`。客户端 `api.ts` 的 `call()` 固定 POST。
- 客户端 bundle 由 tsdown 以单入口、CJS、`__ModuleLoader__` banner 包装成单个 `lib/client.js`（约 343 KB raw），动态 import 无法可靠地拆出按需 chunk。
- 运行时状态根约定：所有可变数据在 `$DSH_HOME/plugins/dsh-pet/`（`src/host/paths.ts`，0700 目录），插件升级/profile 重建不丢；已有 `media-spool`、`workspace` 等同类目录。
- 独立评审（anvil review round 1，APPROVE_WITH_CHANGES）指出的必须修正项已在下方 D1–D10 中逐条落实：资源引用白名单、wire/API 契约、渲染失败可判定性、单文件与并发一致性、按路由请求体上限、复杂度上限、许可与 lockfile、spec strict 校验。

## Goals / Non-Goals

**Goals:**

- 一条最简消费路径：设置里粘贴 Lottie JSON → 校验 → 保存 → 吉祥物立即播放；可复制导出、可移除。
- 素材以普通文件保存在 Pet 状态目录，不进 SQLite，无 schema/迁移。
- 安全与失败边界明确：请求体上限按路由区分；素材格式/资源引用/递归复杂度受限；读取失败与渲染失败一律回退 glyph 而非白屏，且诊断可达 Settings。
- 不引入新的服务进程或网络请求：播放器随 client bundle 分发，素材本地提供，渲染器不执行表达式 `eval`。

**Non-Goals:**

- 不支持 SVG / PNG / GIF / emoji 导入（保留现有 glyph 作为回退）。
- 不做按状态映射（思考中/完成/出错分别用不同动画）、不做表情包分享、不做多素材库、不做远程 URL 拉取或文件上传。
- 不内置任何第三方动画素材，不改 DSH core、compat overlay、preset 或 SQLite schema。

## Decisions

### D1 素材存单个文件，不存 SQLite；文件存在即生效

新增 `$DSH_HOME/plugins/dsh-pet/expressions/`（0700），布局：

```
expressions/
├── active.lottie.json            # 生效中的 Lottie JSON 原文（0600）
└── active.lottie.json.removed    # 最近一次移除的备份（最多一份）
```

- **没有 meta 文件**：`bytes`/`importedAt` 由 `stat` 得出；`label/source/license` 不进模型（YAGNI，评审 S1）。杜绝"两文件成对原子"与 meta 损坏误判有效内容的问题（评审 M6）。
- 生效状态由文件存在性表达，不引入 SQLite 指针/开关；减少两个真相源。
- 写入用「同目录唯一临时名 `active.lottie.json.tmp-<pid>-<now>-<rand>` + `rename`」替换；`finally` 清理残留（评审 M7 A）。POSIX 上 `rename` 覆盖是原子的；Windows 上目标被占用时 `rename` 可能失败，兜底做法是先把旧文件 `rename` 到唯一备份名、再把新文件 `rename` 到生效名（失败时保留旧素材），不采用“先 unlink 目标”这种会丢旧素材的顺序（评审 round 2 S3）。原子性保证只对 POSIX 声明。
- 导入覆盖旧素材：**旧内容不另存**——spec 只在移除时保证不删除当时生效的素材；Settings 在已有动画时导入前显示明确确认文案「当前动画将被替换且不保留，如需保留请先复制」（评审 M8）。
- 移除：`rename(active → .removed)`（覆盖更早备份）；`ENOENT` 视为已移除并返回成功（幂等，评审 M7 B）。
- 备选与否决：*SQLite blob* → 数据库膨胀、用户无法直接查看；*meta sidecar* → 第二个文件带来非原子窗口与无收益复杂度；*多素材内容寻址库* → MVP 用不到，留待按状态映射时升级。

### D2 三条 POST 管理路由 + 明确的 wire 契约

延续现有「精确路径 + POST + `strictBody`」风格（客户端 `api.ts` 只发 POST，`petRoute` 对 GET 特殊处理会引入两套语义）：

| 路由 | body | 成功响应 `data` |
| --- | --- | --- |
| `POST /dsh-pet/api/expression` | `{}` | `{ state: 'none' } \| { state: 'ok', content, bytes, importedAt } \| { state: 'corrupt', diagnostic }` |
| `POST /dsh-pet/api/expression-import` | `{ content: string }` | `{ state: 'ok', bytes }` |
| `POST /dsh-pet/api/expression-remove` | `{}` | `{ state: 'none' }` |

- 新增 `INVALID_EXPRESSION` 到 `PetErrorCode` 并映射 HTTP 400（评审 M2 C）；其余客户端/请求错误沿用 `INVALID_REQUEST`。
- **`content` 读取契约**：导入路由 MUST 原样读取 `content`，MUST NOT 使用会 `trim()` 的 `requireString`——`typeof content !== 'string'`（含缺字段）→ `INVALID_REQUEST`；字符串但内容不合规（含空串/空白串）→ `INVALID_EXPRESSION`（评审 round 2 M3）。
- `content` 以**字符串**返回（读取时），不返回解析后的对象：`petRoute` 的 `redactSecrets` 会递归改写对象（深度 64、键名正则），字符串不进入遍历，天然保真（评审 M2/数据完整性）。
- `bytes`/`importedAt` 由读取时 `stat` 得到；`corrupt` 携带诊断，Host 不抛 500。
- 备选与否决：*GET/DELETE 动词* → 客户端 helper 与路由测试都是 POST 模型，改造成本换不来收益；*返回解析对象* → 被脱敏改写风险。

### D3 请求体上限按路由区分，4 MiB 只给导入

`petRoute(path, handler, options?: { bodyLimit?: number })` 增加可选上限，默认 `MAX_REQUEST_BODY_BYTES = 256 KiB`；只有 expression-import 传 `MAX_EXPRESSION_REQUEST_BODY_BYTES = 4 MiB`。`readJsonBody(req, limit)` 接收该值。素材本身另限 512 KiB（D4）。

- 为什么是 4 MiB：512 KiB 内容含控制字符时 `JSON.stringify` 最坏约 6×（`\u0000` → 6 字节），3 MiB 起步的传输上限才能让"素材超限"而不是"请求体超限"被报出来；4 MiB 留余量。spec 明确：传输超限 → `INVALID_REQUEST`，素材超限 → `INVALID_EXPRESSION`。
- 回归：其余路由必须保持 256 KiB，并有 300 KiB 被拒的测试（评审 M9）。
- 备选与否决：*全局提高上限* → 扩大所有管理路由的解析面；*raw body 上传* → 破坏 `strictBody` 统一模型。

### D4 Host 单一递归校验模块，import 与 read 共用

新增 `src/host/expression.ts`，校验失败抛 `PetError('INVALID_EXPRESSION', …)`；读取路径复用它，损坏时返回 `state: 'corrupt'`：

- 原文 `Buffer.byteLength ≤ 512 KiB`；**UTF-8 往返必须成立**：`Buffer.from(content,'utf8').toString('utf8') === content`，否则拒绝未配对代理项（评审 round 2 M3）；`JSON.parse` 成功且为对象。
- `v` 为 string；`w`/`h` 若存在必须是 ≤2048 的正数；`layers` 非空数组，每层是对象且 `ty` 为 number（拒绝 `layers:[{}]` 这类"校验通过但渲染空白"的内容，评审 M1）。
- **按渲染图**统计参与渲染的层：对 `assets[].id → layer.refId` 建图，**按层类型解析引用**——`ty:0`（precomp 层）的 `refId` 必须解析到含 `layers` 的 precomp，`ty:2`（image 层）的 `refId` 必须解析到带白名单 `p`/`u` 的 image asset 并作为叶子；未知 id 或类型不匹配一律拒绝。从顶层层出发 memo 展开（每个 precomp 被引用 N 次就计 N 份），展开总数 ≤80、引用深度 ≤32、拒绝引用环，并按同一张图校验嵌套 precomp 的 `w`/`h`≤2048。只数 JSON 数组结构会被 `refId` 指数展开绕过（评审 round 1 M4、round 2 M2、round 4 M1）。
- `assets` 若存在必须为数组；每个 asset 必须有唯一字符串 `id`；`p`/`u` 若存在必须是 string，只允许 `''` 或 `data:image/`（大小写不敏感），**拒绝** `data:image/svg+xml`、`http(s)://`、`//`、相对路径、数组/对象等非字符串（评审 M3 A/D、S3）。位图 data URI 还必须能 base64 解码且魔数与声明 MIME 匹配（PNG/JPEG/WebP/GIF），否则拒绝——坏 data URI 会在渲染层表现为“已加载但空白”。
- `fonts.list` 若存在必须为数组；每个条目 `fPath` **若存在必须为空**（缺省合法），`fFamily` 必须匹配 `^[A-Za-z0-9 _.-]{1,64}$`；否则拒绝，避免远程字体与 CSS 注入（评审 M3 B、round 4 M1）。
- 读取前 `stat` 限 512 KiB；读取后再跑同一套校验；损坏 → `corrupt` + 诊断路径（不抛 500）。

### D5 客户端静态打包 lottie-web light（min 构建），体积诚实；真实播放器只在浏览器入口求值

- `import lottie from 'lottie-web/build/player/lottie_light.min.js'` + 本地 `.d.ts` 声明（该路径无类型）。上游 min 文件 168,394 B raw / 46,672 B gzip；实际 build 后 `lib/client.js` 从 343,072 B raw / 86,013 B gzip 增至 590,112 B raw / 145,041 B gzip，即 **+约 241 KiB raw / +约 58 KiB gzip**（含动画特性代码；数字以真实 build 为准，记入 verify）。评审 M10 的“按 import 路径估算”已由此实测替代。
- **不退回完整 `lottie-web`**：完整构建含表达式执行面，用户导入的 JSON 会变成页面内代码执行面；light 构建无该能力（评审 S3）。
- 若 min 路径在 tsdown 下打包失败：保留 `lottie_light.js`（非 min）并如实更新体积数字，不换完整构建。
- 测试环境通过 vitest alias 使用 `test/fixtures/lottie-stub.ts`；生产构建不使用该 alias（`tsdown.config.ts` 不读取 vitest 配置）。
- **import seam 固定**：`PetOverlay` 的 `loadAnimation` prop 是**可选**的——缺省时吉祥物直接显示 glyph（测试与 SSR 夹具无需改造成必需依赖）。真实 lottie 只经 `src/client/player.ts` 由浏览器入口 `src/client/index.tsx` 静态导入，并以 `loadAnimation` 适配器 prop 注入 `PetOverlay`；`overlay.tsx` 与 `mascot-expression.ts` MUST NOT 在模块顶层 import 真实播放器。**测试侧另有第二道闸**：`vitest.config.ts` 把 `lottie-web/build/player/lottie_light.min.js` 全局 alias 到 `test/fixtures/lottie-stub.ts`，因此 `test/mount.test.ts`、`test/directory-picker-face.test.ts` 等顶层 import client entry 的既有 jsdom 测试也不会求值真实 lottie UMD（其顶层 canvas 探测在无 canvas 实现的 jsdom 下会抛 `TypeError`）。回归断言由“导入入口不抛错 + stub 被使用”两条测试固定（评审 round 2 M1、round 3 M1）。
- 播放器包装为可注入依赖（`createMascotAnimation(container, content, { load, environment, isDrawable })`），测试用 fake player 断言，不依赖真实渲染。

### D6 渲染失败可判定 + 跨 root 诊断通道

- `src/client/mascot-expression.ts` 返回 `{ ok: boolean, reason?: string, destroy(): void }`；失败判定改成**事件 + 时序**：订阅播放器 `error`/`onError`（覆盖 config 错误），在 `DOMLoaded` 后用 `requestAnimationFrame` 有界窗口（例如 2 帧或 1s 超时）检查容器；`isLoaded` MUST NOT 作为唯一即时判据（lottie 5.13.0 在 `initItems` 抛错时先置 `isLoaded=true` 且异常被内部吞掉）。可绘制节点只认 `path/rect/circle/ellipse/line/polyline/polygon/image`，排除 `g/defs/clipPath/mask`；空 shape 层与坏 `<image>` 因此判为失败（评审 round 2 M5）。
- 新增 `src/client/mascot-diagnostics.ts`：模块级诊断 store（`setExpressionDiagnostic` / `getExpressionDiagnostic` / 订阅），并通过 `PET_EXPRESSION_EVENT` 广播；overlay 写入失败原因，Settings 外观页读取并展示。这样不依赖"两个 React root 共享 state"（评审 M1 触发 2）。
- 渲染成功时清除上一次诊断。

### D7 播放策略与生命周期

- 纯函数 `resolvePlayback({ reducedMotion, hidden }): 'play' | 'pause'`；挂载时按该函数决定是否 `autoplay`，监听 `matchMedia('(prefers-reduced-motion: reduce)')` 的 change 与 `visibilitychange` 重新求值。
- `reducedMotion` 为真时始终 `goToAndStop(0, true)`（停首帧）；即使从隐藏恢复也 MUST NOT 播放（评审 M5）。
- 卸载/切换素材时 `destroy()` 并移除全部 listener；容器 `pointer-events:none`、`aria-hidden="true"`，不占拖动/点击/键盘焦点（评审 S7）。
- 读取请求带单调 request id：只有最新一次读取可写入状态，迟到响应丢弃（评审 M7 C）；`AbortController` 或序号都可行，实现用序号以保持可测。

### D8 即时生效与覆盖确认

- Settings 导入/移除成功后 `dispatchEvent(new Event(PET_APPEARANCE_EVENT))`（已有机制，overlay 已监听）；overlay 的 `load()` 同时重读 config 与 expression。
- 已有生效动画时，导入按钮先展示「当前动画将被替换且不保留，如需保留请先复制导出」确认；确认后才发请求。

### D9 许可与发布

- `lottie-web@5.13.0` 固定版本、放 devDependencies（构建时打包，运行时不安装，避免 25 MB 解包体积进入依赖树）；根 `package-lock.json` 同步更新（CI 用 `npm ci`，评审 M11）。
- 新增 `packages/dsh-pet/THIRD-PARTY-NOTICES.md`（沿用仓库既有命名），原文照录 lottie-web 的 MIT 文本与版本；加入 `package.json#files`，verify 用 `npm pack --dry-run` 证明其进入 tarball（评审 S5）。
- 仓库不分发任何动画素材；用户素材的来源与许可由用户负责，README 写明。

### D10 版本与交付边界

- `packages/dsh-pet/package.json` 与 `dsh.yaml` 的 dsh-pet 条目版本 0.1.0 → 0.2.0；`dsh.yaml` note 增加"动画表情文件在状态目录、无 schema 变更、lottie-web MIT"。
- 无 DB schema/版本变更、无新 Host 常驻服务、无 compat 变更。回滚：`dsh.yaml` 置 `enabled:false` → `dsh build`；用户素材留在状态目录。

## Risks / Trade-offs

- **[客户端 bundle 增大约 168 KiB raw / 47 KiB gzip]** → verify 用真实 build 复测；本地插件一次加载，接受；若未来体积敏感，改为 Host 提供播放器文件按需注入。
- **[常驻浮层播放动画持续消耗 CPU]** → 递归层数 ≤80、尺寸 ≤2048、reduced-motion 停首帧、页面隐藏暂停；Settings 提示复杂度限制。
- **[用户素材来源/许可不可控]** → 不内置素材；README 明确用户责任；UI 只做技术校验，不做许可判断。
- **[lottie-web 上游维护/安全]** → 固定 5.13.0（2025-05-21，Snyk 无直接漏洞记录）；只用无表达式执行的 light 构建；升级需重新审查。
- **[用户手动改坏/替换 `active.lottie.json`]** → `stat` + 校验，损坏回退 glyph 并显示诊断；Host 不抛 500。
- **[Windows rename 覆盖已存在文件语义]** → Node `fs.rename` 在 POSIX 原子覆盖；Windows 上目标存在时可能失败。兜底顺序是「先把旧文件 rename 到唯一 displaced 名（保留）→ 再 rename 新文件 → 成功后清理 displaced / 失败则恢复旧文件」，MUST NOT 先 unlink 目标（那会在第二步失败时永久丢旧素材）。原子性只在 POSIX 上声明（spec 已按平台措辞）。
- **[lottie_light.min.js 在 tsdown 下打包失败]** → 构建阶段即暴露；备选非 min 的 light 构建并更新数字，不换完整构建。

## Migration Plan

1. 升级 package 与 `dsh.yaml` 版本 → `npm install` 更新 lockfile → `dsh build` 物化 → 重启 DSH。
2. 首次使用无需迁移：`expressions/` 由 `ensurePetDirectories` 幂等创建，空目录即"未导入"。
3. 回滚：`enabled: false` → `dsh build`；状态目录与用户素材保留。降级回 0.1.0 时旧代码不认识 `expressions/`，但不会读取或破坏它。

## Open Questions

- 无阻塞问题。已知非阻塞项：`isTrustedRequest` 对 `Origin: null` 的既有信任语义被新的 4 MiB 写路由继承；本 change 不改变该信任边界，留作独立后续（round 3 S2 / round 4 S5）。后续可扩展（不在本 change）：按状态映射不同动画、SVG/PNG 导入、表情包导出/分享、远程 URL 导入（需先解决隐私与 CSP）。
