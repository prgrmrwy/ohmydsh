## 1. peer 声明对齐

- [x] 1.1 `packages/worktree-session/package.json`:9 条 `^0.1.0-rc.7` 改为 `^0.1.1-rc.2`
- [x] 1.2 同上:`@deepseek-ai/dsh-storage-domain` 与 `@deepseek-ai/dsh-workspace` 的精确 pin `0.1.0-rc.7` 改为 `^0.1.1-rc.2`(消除双实例隐患)
- [x] 1.3 `packages/sidebar-session-provider-icon/package.json`:4 条 `^0.1.0-rc.7` 改为 `^0.1.1-rc.2`
- [x] 1.4 `packages/subscriptions-sandbox-shim/package.json`:`@deepseek-ai/dsh-llm` 由 `^0.1.0-rc.5` 改为 `^0.1.1-rc.2`
- [x] 1.5 确认非运行体 peer(`react`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`)保持不变
- [x] 1.6 `packages/worktree-session` 的 14 条 `@deepseek-ai/dsh-*` devDependencies 由 `^0.1.0-rc.7` 改为 `^0.1.1-rc.2`
- [x] 1.7 `packages/sidebar-session-provider-icon` 的 4 条 devDependencies 对齐(含精确 pin `@deepseek-ai/dsh-client-ui-model-selection 0.1.0-rc.7` → 范围写法)
- [x] 1.8 更新根 `package-lock.json` 使其解析到对齐后的版本(仅 workspace 依赖变动)

## 2. 漂移检查

- [x] 2.1 新增 `tests/local-package-peers.test.mjs`:读 `dsh.yaml` 的 `dshVersion` 与全部 `packages/*/package.json`,校验 `@deepseek-ai/dsh-*` peer 处于当前版本族
- [x] 2.2 该检查同时拒绝精确 pin(非范围写法),失败信息指出 package、依赖名与实际声明
- [x] 2.3 断言非运行体依赖不被该检查约束

## 2b. 对齐暴露的 API 破坏(实施中新增)

- [x] 2b.1 `dsh-session-projection` 契约变更(`schema` → `stateSchema` + `wire{viewSchema,view}`):迁移 `sidebar-session-provider-icon` 的 projection 定义,并在 `types.ts` 合并 `SessionProjectionStateMap`
- [x] 2b.2 新增测试覆盖迁移后的契约与 state/wire schema 分离
- [x] 2b.3 `worktree-session/test/manifest.test.ts` 移除硬编码 `rc.7` 断言,改为「同一版本族 + 禁止精确 pin」的自洽校验(版本族归属由仓库级检查负责)
- [x] 2b.4 补 `react-dom` devDependency:测试直接 import `react-dom/server`,此前仅靠旧版本族的传递依赖 hoisting 侥幸可用

## 3. 部署残留清理

- [x] 3.1 对 `@deepseek-ai/dsh-subagent-codex` 与 `@deepseek-ai/dsh-sdk-protocol` 各执行一次 `dsh plugin --profile web remove <name>`(与 sync 内部同一条命令,绕过其针对未安装项的守卫)
- [x] 3.2 确认 `$DSH_HOME/profiles/web/package.json` 与 `pnpm-lock.yaml` 不再引用二者
- [x] 3.3 确认 `dsh.yaml` 未被改动,且 sync 仍报告与 manifest 一致(账本未因此产生新漂移)

## 4. 验证

- [x] 4.1 `npm test` 全绿(含新增 peer 检查)
- [x] 4.2 两个 TypeScript local package 各自的 build 与 typecheck **对 0.1.1-rc.2 的实际类型**通过;若暴露 API 破坏,记录并修复源码(这是本次对齐的核心验证点)
- [x] 4.3 `node scripts/sync.mjs` 连续两次执行,第二次报告无变化(幂等)
- [x] 4.4 `npm run check:artifacts` 通过
- [x] 4.5 重启 DSH,确认 11 个 bundle 仍全部加载、无新增告警
