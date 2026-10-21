## 1. 默认数据目录

- [x] 1.1 先写失败测试：未配置 dataDir 时使用 `$DSH_HOME/plugins/dsh-collab` 且为 0700；显式绝对路径优先、不创建默认目录；相对路径仍拒绝。验证：`npm --workspace packages/dsh-collab test` 中新用例先失败再通过
- [x] 1.2 实现：Config 中 `dataDir` 改为可选；`validateConfig` 按官方规则解析 DSH home（Host 进程环境中的非空 `DSH_HOME`，否则 `~/.dsh`）得到默认目录，其余校验不变。验证：1.1 全绿

## 2. 包不自带禁用行

- [x] 2.1 先写失败测试：打包产物的 `cordis.patch.yml` 中 dsh-collab 行不含 `disabled: true`。验证：build-artifact 测试先失败再通过
- [x] 2.2 修改 `cordis.patch.yml` 与双语 README（配置说明、默认目录、启用方式）。验证：2.1 通过，`node --test tests/repo-docs-governance.test.mjs` 通过

## 3. 部署与回归

- [x] 3.1 全量回归：dsh-collab typecheck/test/test:components/test:host，根 `npm test`，`npm run check:artifacts`，`openspec validate --strict`
- [x] 3.2 inner-ohmydsh 去掉 `dataDir` 与 `disabled: false`；本机 `dsh build` 两次幂等、`dsh restart`；确认实际数据目录与 serviceId 不变，collab 工具可用
