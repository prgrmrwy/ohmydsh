## Test Plan

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-pet/spec.md → 动画表情以状态目录下的单文件持久化 | 导入合法动画后读取到原文 | test/expression.test.ts | `saves the source and reads it back verbatim` | 🟢 green |
| specs/dsh-pet/spec.md → 动画表情以状态目录下的单文件持久化 | 读取不落库且不触碰数据库文件 | test/expression-routes.test.ts | `writes only inside the expressions directory` | 🟢 green |
| specs/dsh-pet/spec.md → 动画表情以状态目录下的单文件持久化 | 无生效素材时读取返回 none | test/expression.test.ts | `reads none when no expression exists` | 🟢 green |
| specs/dsh-pet/spec.md → 动画表情以状态目录下的单文件持久化 | 移除后保留备份且重复移除幂等 | test/expression.test.ts | `removes to a backup and stays idempotent` | 🟢 green |
| specs/dsh-pet/spec.md → 动画表情以状态目录下的单文件持久化 | 重复导入覆盖上一份且不产生备份 | test/expression.test.ts | `replaces the active source without creating a backup` | 🟢 green |
| specs/dsh-pet/spec.md → 动画表情以状态目录下的单文件持久化 | 已有动画时导入先提示替换 | test/client.test.ts | `warns before replacing the active expression` | 🟢 green |
| specs/dsh-pet/spec.md → 动画表情以状态目录下的单文件持久化 | 导出读取到原文 | test/expression-routes.test.ts | `exports the stored source verbatim` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 缺少 layers 或层缺少 ty 被拒绝 | test/expression-routes.test.ts | `keeps the current expression when validation fails` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 非法 JSON、顶层非对象或缺少 v 被拒绝 | test/expression.test.ts | `rejects invalid JSON, non-object roots and missing v` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | assets 非数组被拒绝，缺省或空数组通过 | test/expression.test.ts | `rejects non-array assets and non-object entries` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 顶层或 precomp 的 w/h 非法被拒绝 | test/expression.test.ts | `rejects unusable declared dimensions` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 无法往返的 UTF-8 或非字符串正文被拒绝 | test/expression-routes.test.ts | `distinguishes a non-string body field from an unusable string` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 前后空白被原样保留 | test/expression.test.ts | `keeps leading and trailing whitespace byte for byte` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 远程或相对资源引用被拒绝 | test/expression.test.ts | `rejects remote, protocol-relative, relative and non-string asset references` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 仅允许可解码的内嵌位图 data URI | test/expression.test.ts | `allows only decodable embedded bitmap data URIs` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | image 层通过 refId 引用内嵌位图，类型不匹配被拒绝 | test/expression.test.ts | `resolves refId by layer type and rejects type mismatches` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 远程字体或非法字族被拒绝 | test/expression.test.ts | `rejects remote fonts and unsafe font families` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 按 refId 展开的渲染图超限或成环被拒绝 | test/expression.test.ts | `expands refId precomps and rejects cycles or exponential blowup` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | precomp 引用深度超过上限被拒绝 | test/expression.test.ts | `rejects precomp reference chains deeper than the cap` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 正常嵌套 precomp 与嵌套尺寸通过校验 | test/expression.test.ts | `counts nested precomp layers and dimensions recursively` | 🟢 green |
| specs/dsh-pet/spec.md → 导入内容在 Host 侧受内容安全校验 | 读取损坏或超限文件返回 corrupt 而非抛错 | test/expression.test.ts | `reports corrupt instead of throwing for broken or oversized files` | 🟢 green |
| specs/dsh-pet/spec.md → 管理路由的请求体上限按路由区分 | 素材超限但请求体未超限时返回素材错误 | test/expression-routes.test.ts | `accepts the transport limit but rejects the oversized source` | 🟢 green |
| specs/dsh-pet/spec.md → 管理路由的请求体上限按路由区分 | 超过 4 MiB 的导入请求被请求体上限拒绝 | test/expression-routes.test.ts | `rejects request bodies over 4 MiB with INVALID_REQUEST` | 🟢 green |
| specs/dsh-pet/spec.md → 管理路由的请求体上限按路由区分 | 其余管理路由维持 256 KiB 上限 | test/expression-routes.test.ts | `keeps the 256 KiB limit for every other route` | 🟢 green |
| specs/dsh-pet/spec.md → 吉祥物渲染、回退与可诊断 | 动画优先于 glyph | test/mascot-expression.test.ts | `prefers a valid animation over the glyph` | 🟢 green |
| specs/dsh-pet/spec.md → 吉祥物渲染、回退与可诊断 | 渲染失败时回退 glyph 并显示诊断 | test/mascot-expression.test.ts | `falls back and publishes a diagnostic when the player fails` | 🟢 green |
| specs/dsh-pet/spec.md → 吉祥物渲染、回退与可诊断 | 读取为 corrupt 时显示 glyph 并暴露诊断 | test/mascot-expression.test.ts | `renders the glyph and exposes the diagnostic for a corrupt read` | 🟢 green |
| specs/dsh-pet/spec.md → 吉祥物渲染、回退与可诊断 | 减少动效或页面隐藏期间不播放 | test/mascot-expression.test.ts | `never plays under reduced motion or while hidden` | 🟢 green |
| specs/dsh-pet/spec.md → 吉祥物渲染、回退与可诊断 | 导入与移除无需刷新即生效 | test/mascot-expression-dom.test.ts | `refreshes the mascot on appearance broadcast without reload` | 🟢 green |
| specs/dsh-pet/spec.md → 吉祥物渲染、回退与可诊断 | 迟到的旧读取结果不覆盖新状态 | test/mascot-expression.test.ts | `ignores stale reads so a late response cannot resurrect an expression` | 🟢 green |
| specs/dsh-pet/spec.md → 吉祥物渲染、回退与可诊断 | 测试环境导入客户端入口不求值真实播放器 | test/mascot-expression-dom.test.ts | `imports the client entry under jsdom without evaluating the real player` | 🟢 green |
| specs/dsh-pet/spec.md → 播放器依赖与许可随包发布 | 发布清单包含播放器许可声明 | test/expression-packaging.test.ts | `ships the player notice in package files` | 🟢 green |
| specs/dsh-pet/spec.md → 播放器依赖与许可随包发布 | 只使用 light 构建并由浏览器入口注入 | test/expression-packaging.test.ts | `imports the light player only from the browser entry` | 🟢 green |
| specs/dsh-pet/spec.md → 播放器依赖与许可随包发布 | 仓库不内置动画素材 | test/expression-packaging.test.ts | `bundles no animation assets` | 🟢 green |

## Coverage Notes

- Host 校验与存储：`test/expression.test.ts` 直接调用 `src/host/expression.ts`，用 `mkdtemp` 建真实临时目录；校验失败抛 `PetError('INVALID_EXPRESSION')`，读取路径返回 `corrupt`。
- 路由契约：`test/expression-routes.test.ts` 通过 `createPetRoutes` 的真实 handler 驱动 fake req/res，可设置请求体大小与 Host 头；断言错误码、HTTP 状态与 `/dsh-pet/api/expression*` 的三条 POST 契约。
- 客户端：`test/mascot-expression.test.ts` 使用注入 fake loader/environment（含 error 事件、空 shape 层、坏图片的失败 fixture）；`test/mascot-expression-dom.test.ts` 用 jsdom 挂载 overlay，通过 `loadAnimation` prop 注入 fake，并驱动 `PET_APPEARANCE_EVENT`。
- jsdom 入口隔离：`vitest.config.ts` 把真实播放器模块 alias 到 `test/fixtures/lottie-stub.ts`，`mount`/`directory-picker-face`/`interaction` 等既有 jsdom 测试因此不被 UMD canvas 探测打断；`test/mascot-expression-dom.test.ts` 断言入口导入不抛错且 stub 被调用，`test/expression-packaging.test.ts` 断言生产源码只从浏览器入口导入 light 构建。
- 发布物：`test/expression-packaging.test.ts` 读取 `package.json#files`、声明文件与仓库动画素材分布，作为可机械执行的发布契约检查。
- 结果记录：`npm test` 会先跑 `pretest`（build）；最终 build/typecheck/全量测试结果写进 `verify.md`。
