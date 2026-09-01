## 1. 包骨架

- [x] 1.1 创建 `packages/session-title-copy/`（package.json、cordis.patch.yml、tsconfig.json、tsconfig.client.json、tsdown.config.ts、vitest.config.ts、README.md、CHANGELOG.md、LICENSE）
- [x] 1.2 package.json 声明 `dsh.bundle.patch`、`dsh.client`（platform web）、`exports["./client"]` 与 peer/dev 依赖（cordis、dsh-client-runtime、typescript、tsdown、vitest）

## 2. Host 空入口与 Client 接线

- [x] 2.1 `src/index.ts`：no-op host 入口（name/inject/apply），保证 loader 可加载且 client-modules scanner 能发现浏览器包
- [x] 2.2 `src/client/title-locator.ts`：官方 header 面包屑 DOM 定位（header 内 nav 中 crumb 后缀按钮；当前标题 = disabled 按钮），结构知识只在此文件
- [x] 2.3 `src/client/index.ts`：inject `sessions`；effect 内 MouseObserver + sessions.list.subscribe → 幂等 reconcile（打自有标记、removeAttribute('disabled')、capture click 拦截 stopPropagation、内联 cursor:pointer、复制 + 瞬态反馈）；清理函数完整
- [x] 2.4 复制实现：`navigator.clipboard.writeText` try/catch 静默降级；反馈为 body 级 fixed 瞬态提示（1.2s 自动移除）

## 3. 测试

- [x] 3.1 `test/title-locator.test.ts`：定位当前标题/祖先 crumb/未知结构降级（结构桩）
- [x] 3.2 `test/copy-flow.test.ts`：点击复制当前 id、拦截不触达官方 onClick、reconcile 幂等、剪贴板失败静默

## 4. Manifest 与仓库登记

- [x] 4.1 `dsh.yaml` 增加 `session-title-copy` local customization 条目（version/brief/note，含 B018 引用）
- [x] 4.2 `BACKLOG.md` 增加 B018 条目（状态：实施中）

## 5. 构建与验证

- [x] 5.1 `npm run typecheck` + `npm run build`（tsdown 产出 lib/client.js、tsc 产出 lib/index.js）通过
- [x] 5.2 `npm test`（vitest 16/16）全部通过
- [x] 5.3 以隔离 DSH_HOME 运行 `node scripts/sync.mjs`（29 changes 应用），连续第二次报 `no changes`（幂等）
- [x] 5.4 仓库级 `npm test`（81/81）与 `npm run check:artifacts` 通过

## 6. 收尾

- [x] 6.1 openspec validate 通过；任务状态与实际进度一致
- [x] 6.2 汇总验收说明（重启 DSH 后 GUI 人工复核点）
