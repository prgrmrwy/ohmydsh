## 1. 插件包

- [x] 1.1 以 `packages/system-clock` 为模板建立 `packages/jev-workflow-router-hook/`（package.json、tsconfig、vitest、cordis.patch.yml、README/README.zh、LICENSE），仅 Host 入口，无 client
- [x] 1.2 实现 `src/index.ts`：`tools/post-execute` 监听、触发匹配、`WeakMap` 状态、开关检查、`createUserMessage` 提醒并 prepend 到下游 `additionalContexts`
- [x] 1.3 单测覆盖 delta spec 全部场景（触发两种、已用 router、每 agent 一次、无关调用、下游 block/已有上下文、SKILL.md 缺失与环境变量禁用）
- [x] 1.4 `npm run build`、`typecheck`、`test` 通过

## 2. Manifest 与文档

- [x] 2.1 `dsh.yaml` 在 `jev-workflow-router` 条目旁新增 local package 条目（brief/note：信任面、升级复核、移除步骤）
- [x] 2.2 连带关闭关系写在新插件条目 note 中（router 条目 note 已接近 600 字上限，保持原样）

## 3. 验证与收尾

- [x] 3.1 仓库级 `npm test`、`npm run check:artifacts`、`openspec validate add-jev-router-openspec-reminder-hook --strict`
- [x] 3.2 worktree 预览：`dsh build` → `ws prepare-preview` → `dsh`，在预览会话中加载 `openspec-propose`，确认提醒出现一次且以通知形态呈现、工具结果不变
- [x] 3.3 用户验收后同步 delta spec 到 `openspec/specs/jev-workflow-routing/spec.md` 并归档
