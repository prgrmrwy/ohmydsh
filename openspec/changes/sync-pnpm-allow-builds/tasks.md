## 1. manifest

- [ ] 1.1 `loadManifest` 校验顶层 `pnpmAllowBuilds`（映射、非空字符串键、布尔值），错误信息含字段名与键；结果放进 manifest 返回值
- [ ] 1.2 `dsh.yaml` 增加 `pnpmAllowBuilds`（`'@google/genai': false`、`protobufjs: false`、`node-pty: true`），附注释说明来源与审查依据
- [ ] 1.3 确认 overlay 的顶层字段白名单仍只放行 `customizations`，并有测试覆盖

## 2. 物化与预检

- [ ] 2.1 实现 `syncAllowBuilds(manifest, state)`：持 profile 锁，用 yaml Document API 局部修改 `allowBuilds`，无差异时不写文件，有写入时输出 change
- [ ] 2.2 账本 `pnpmAllowBuilds` 的记录与撤销（部署值等于记录值才删，否则报漂移）；`--reset` 走同一撤销路径
- [ ] 2.3 写入后扫描非布尔条目，存在时抛出首因错误（含依赖名、文件路径、`pnpmAllowBuilds`）
- [ ] 2.4 在 `main` 中把该步骤放到 `migrateLegacyState` 之后、`syncDependencies` 之前

## 3. 安装失败首因

- [ ] 3.1 新增 `pluginCli` 包装，替换全部 `dshCli(['plugin', …])` 调用；失败后若出现新的未决定条目，抛出与 2.3 同形的错误，中断运行

## 4. 测试与验证

- [ ] 4.1 新增 `tests/sync-pnpm-allow-builds.test.mjs`，覆盖 spec 中全部场景（隔离的 `DSH_HOME` 与假 DSH_BIN）
- [ ] 4.2 运行 `npm test`、`npm run check:artifacts`、`openspec validate sync-pnpm-allow-builds --strict`
- [ ] 4.3 隔离 home 中连续两次 `node scripts/sync.mjs`，第二次无变化
