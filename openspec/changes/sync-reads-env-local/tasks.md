## 1. 解析与填充

- [x] 1.1 新增 `scripts/lib/env-local.mjs`：
  - 字面值解析器，返回 `{name, value, line, literal}` 列表；
  - `applyEnvLocal({repo, env, names})`：调用方已设置则跳过，无法字面确定则抛错或报告，返回已采用的变量名。
- [x] 1.2 `enabledEnvNames(doc)`：从合并后的 manifest 收集 `enabledEnv` 名。

## 2. 接入脚本

- [x] 2.1 `scripts/sync.mjs` 接入：
  - 在 `loadManifest` 前填充 `DSH_LOCAL_MANIFEST`；
  - 合并 overlay 后填充 `enabledEnv` 变量；
  - 输出来源提示。
- [x] 2.2 `scripts/plugin-update.mjs` 接入：严格模式，行为同 sync。
- [x] 2.3 `scripts/plugin-list.mjs` 接入：降级模式，只写 stderr，不输出来源提示到 stdout。

## 3. 测试

- [x] 3.1 `tests/sync-env-local.test.mjs`：覆盖 delta spec 全部场景，含第二次运行无变化。
- [x] 3.2 解析器单测：export、引号、注释、`$`、反引号、`~`、未闭合引号，以及非白名单行不报错。
- [x] 3.3 `npm test` 全绿，`npm run check:artifacts` 通过。

## 4. 文档与收尾

- [x] 4.1 更新 `docs/notes/local-manifest-overlay.md` 与 `.env.local.example` 注释。
- [ ] 4.2 在主 checkout 裸跑 `node scripts/sync.mjs` 两次（不 source），确认 overlay 包保留、第二次无变化。
- [x] 4.3 运行 `openspec validate sync-reads-env-local --strict`。
