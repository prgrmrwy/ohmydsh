## Why

Pet 的悬浮吉祥物目前只能显示一个 emoji 字形（默认 🐾，可在设置里换成单个字符），无法表达"正在干活 / 完成 / 出错"，用户也没有任何方式接入现成的动画素材。用户希望走最简路径消费：**在设置里粘贴从官网导出的 Lottie JSON，保存后吉祥物立即播放这个动画**，不需要构建、不需要新增资源包、不需要理解配置格式。

## What Changes

- 新增 **Pet 设置 → 外观 → 动画表情**：一个 textarea 粘贴 Lottie JSON，Host 校验后原子写入 `$DSH_HOME/plugins/dsh-pet/expressions/active.lottie.json`；支持复制导出原文与移除（保留最近一份 `.removed` 备份）。
- **只存文件、不进 SQLite**：无 meta/附属文件，生效状态由文件存在性表达；无数据库 schema/版本变更。
- 三条管理路由统一为现有 POST + `strictBody` 风格：读取（`state: none | ok | corrupt`）、导入、移除；新增错误码 `INVALID_EXPRESSION` 映射 HTTP 400。
- **支持从 HTTPS URL 导入**：设置里粘贴 URL 后由 **Host 侧下载**（浏览器网络受限/CDN 被墙时仍可用；CORS 也不影响），下载走 SSRF 防护（仅 https、默认 443、无凭据、≤3 次重定向且每跳重新校验 DNS、10s 超时、≤512 KiB、JSON 类 content-type 白名单）；下载内容复用同一套源校验。新增错误码 `EXPRESSION_FETCH_FAILED`（HTTP 502）。
- 浮层吉祥物在有有效导入时用 **lottie-web light 构建（MIT，固定 5.13.0，静态打包）** 播放动画，否则回退 glyph；导入/移除通过既有 `PET_APPEARANCE_EVENT` 与新增的客户端诊断通道立即生效，无需刷新页面。
- **安全边界**：该导入路由单独允许 4 MiB 请求体（其余路由保持 256 KiB）；素材 ≤512 KiB；按 `assets[].id → layer.refId` 渲染图展开后层数 ≤80、引用深度 ≤32、拒绝成环/未知引用；嵌套 precomp 宽高 ≤2048；图片 asset 的 `p/u` 只允许空串或可解码的 `data:image/` 位图（拒绝 SVG/无效 base64/远程/相对路径/非字符串），precomp 不要求图片引用；`fonts[].fPath` 若存在必须为空且 `fFamily` 限安全字符；读取前用 `stat` 限长；读取损坏文件返回 `corrupt` 而非 500。
- **渲染失败可判定**：订阅播放器 `error`/`onError`，在 `DOMLoaded` 后的有界帧窗口内检查容器是否产生真正的绘制节点（排除 `g`/`defs` 等容器），失败回退 glyph，并通过客户端共享诊断状态让 Settings 可见；`reducedMotion || document.hidden` 期间永不播放；迟到的旧读取响应不得覆盖新状态。
- **测试隔离**：真实 lottie 只从浏览器入口经 `src/client/player.ts` 注入，`vitest.config.ts` 全局 alias 到测试 stub，保证既有的 jsdom `mount`/`directory-picker-face`/`interaction` 测试不执行真实播放器的 canvas 探测。
- **许可**：lottie-web light 为 MIT，新增 `THIRD-PARTY-NOTICES.md` 并纳入发布 `files`；不内置任何第三方动画素材。
- dsh-pet 版本 0.1.0 → 0.2.1（`dsh.yaml` 与 `package.json` 同步；0.2.0 为粘贴导入，0.2.1 为 URL 导入增量），`package-lock.json` 随新增 devDependency 更新；无 DSH core 或 compat 变更。

## Capabilities

### New Capabilities

无。本 change 不引入新的 spec capability。

### Modified Capabilities

- `dsh-pet`：新增四条 requirement，覆盖动画表情的存储与移除生命周期、Host 安全校验边界与请求体上限、吉祥物渲染/回退/动效策略与即时生效、播放器依赖与许可随包发布。

## Impact

- **代码**：`packages/dsh-pet/src/wire.ts`（新增 `expression-import-url` 路由、`EXPRESSION_FETCH_FAILED`）（路由/类型/上限常量/错误码）、`src/host/http.ts`（`petRoute` 与 `readJsonBody` 的每路由请求体上限）、`src/host/errors.ts`（新增错误码状态映射）、`src/host/paths.ts`（`expressionsRoot`）、`src/host/expression.ts`（新增：递归校验与单文件存储）、`src/host/expression-fetch.ts`（新增：Host 侧 URL 下载与 SSRF 防护）、`src/host/routes.ts`、`src/index.ts`（路由挂载）、`src/client/api.ts`、`src/client/mascot-expression.ts`（新增：可注入播放器与播放策略）、`src/client/mascot-diagnostics.ts`（新增：跨 root 诊断通道）、`src/client/overlay.tsx`、`src/client/settings.tsx`、`src/client/styles.ts`。
- **测试**：新增 `test/expression-fetch.test.ts`（URL/SSRF 边界）、`test/expression-transport.test.ts`（`defaultRequest` 专用 agent + pinned lookup 回归）、`test/expression.test.ts`、`test/expression-routes.test.ts`、`test/mascot-expression.test.ts`、`test/mascot-expression-dom.test.ts`、`test/expression-packaging.test.ts`；新增 `test/fixtures/lottie-stub.ts` 并在 `vitest.config.ts` 全局 alias 播放器模块；更新 `test/paths.test.ts`、`test/route-validation.test.ts`（路由契约）、`test/client.test.ts`、`test/interaction.test.ts`、`test/mount.test.ts`、`test/directory-picker-face.test.ts`（jsdom 入口隔离回归）。
- **依赖/构建**：devDependency `lottie-web@5.13.0`（MIT，打包进 client bundle，运行时不安装）；根 `package-lock.json` 更新；新增 `packages/dsh-pet/THIRD-PARTY-NOTICES.md` 并加入 `package.json#files`。
- **文档/配置**：`packages/dsh-pet/README.md`、`README.zh.md`、`dsh.yaml`（版本与 note）；不触碰 DSH core、compat overlay、executor preset 或 SQLite schema。
