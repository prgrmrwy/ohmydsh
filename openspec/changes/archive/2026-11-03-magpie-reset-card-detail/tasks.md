## 1. host 投影

- [x] 1.1 在 `test/cards-refresh.test.ts` 加宿主投影用例：`resets.each[]` 只保留 `until`/`window`，`byWindow`/`fiveHour`/`weekly` 透传，`id`/`debug` 被丢弃
- [x] 1.2 `src/host/cards.ts` 的 `projectCards` 按固定白名单投影 `resets`，跑该测试转绿

## 2. 渲染

- [x] 2.1 在 `src/client/view-model.ts` 增加 `CardReset`/`CardResets` 类型与相对过期提示函数（天/小时/已过期/不可解析时不显示）
- [x] 2.2 重写 `src/client/UsageCard.ts` 的重置区为折叠列表（对齐 subscriptions 插件）：摘要「用量限制重置 · 可用 N 次」、展开逐张「完整重置/窗口 + {时间} 到期」、缺到期时间「到期时间不可用」、最早一张相对提示；保持只读、无按钮；`styles.ts` 补折叠列表样式
- [x] 2.3 更新 `src/client/locales.ts` 的 zh/en 文案（新增摘要/窗口/相对提示 key，移除被取代的旧 key）
- [x] 2.4 在 `test/cards-render.test.tsx` 覆盖 delta spec 的「逐张列出」「按窗口的次数」「相对过期提示」「缺失到期时间」四个 scenario，并保持既有 scenario 绿

## 3. 版本与文档

- [x] 3.1 `packages/dsh-magpie-connector/package.json` 升到 0.5.2，`CHANGELOG.md` 记录本次字段与展示变化
- [x] 3.2 README（中/英）用量卡片行与「只读」说明补上逐张重置卡过期时间
- [x] 3.3 `dsh.yaml` 中 `dsh-magpie-connector` 条目版本与说明同步

## 4. 验证

- [x] 4.1 包内 vitest 全绿（426/426）。注意 lean 依赖模式需用临时 config 把 `cacheDir`/`fsModuleCachePath` 指向 /tmp，见 memex 卡 `lean-worktree-package-vitest-cache-dir`
- [x] 4.2 `npm run typecheck --workspace packages/dsh-magpie-connector` 通过
- [ ] 4.3 需要可视验收时：worktree 内 `dsh build` → `ws prepare-preview` → `dsh`，确认重置区在浅/暗主题下的换行与字号，验收后清理
