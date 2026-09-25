## Test Plan

Requirement abbreviations used in the table (all in `specs/repo-layout/spec.md`):

- **R1** → 「manifest 支持本地与远端两种定制来源」
- **R2** → 「本地 manifest overlay 追加不可公开定制」
- **R3** → 「定制可声明所需 npm scope 且 sync 在变更前校验」
- **R4** → 「仓库测试与本机 overlay 隔离」

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/repo-layout/spec.md → R1 | 声明 remote 定制 | tests/manifest-version-drift.test.mjs | every pinned manifest version is a plain release version sync can compare | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R1 | 声明 local 定制 | tests/sync-overlay-root.test.mjs | public local package installs from the public packages dir | 🟢 green |
| specs/repo-layout/spec.md → R1 | 公开条目不从 overlay 根取源码 | tests/sync-overlay-root.test.mjs | public entry never takes source from the overlay root | 🟢 green |
| specs/repo-layout/spec.md → R2 | overlay 缺失时行为不变 | tests/sync-local-manifest-overlay.test.mjs | no overlay: sync behaves exactly as before | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | overlay 条目被追加物化 | tests/sync-local-manifest-overlay.test.mjs | overlay entry is appended and materialized | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | overlay 条目出现在启动清单与升级检查 | tests/sync-local-manifest-overlay.test.mjs | startup listing includes overlay entries / update check covers overlay remote entries | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | id 与公开 manifest 冲突时拒绝运行 | tests/sync-local-manifest-overlay.test.mjs | id colliding with the public manifest is rejected | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | overlay 声明顶层字段时拒绝运行 | tests/sync-local-manifest-overlay.test.mjs | overlay declaring a top-level field is rejected | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | overlay 条目不因来源而放宽校验 | tests/sync-local-manifest-overlay.test.mjs | overlay entries are not exempt from per-field validation | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | overlay 存在但不可解析时拒绝运行 | tests/sync-local-manifest-overlay.test.mjs | present but unparsable overlay fails closed | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | 环境变量指定 overlay 路径 | tests/sync-local-manifest-overlay.test.mjs | DSH_LOCAL_MANIFEST replaces the default overlay path | 🟢 existing (regression) |
| specs/repo-layout/spec.md → R2 | 公开 manifest 不承载不可公开定制的痕迹 | tests/sync-overlay-root.test.mjs | syncing an external overlay leaves the public repo byte-identical | 🟢 green |
| specs/repo-layout/spec.md → R2 | 含 overlay 时 sync 仍幂等 | tests/sync-overlay-root.test.mjs | external overlay root sync is idempotent | 🟢 green |
| specs/repo-layout/spec.md → R2 | 外部 overlay 根的 patch 与 skill 从该根物化 | tests/sync-overlay-root.test.mjs | external overlay root materializes its own patch and skill | 🟢 green |
| specs/repo-layout/spec.md → R2 | 外部 overlay 根缺少条目源码时在物化前拒绝运行 | tests/sync-preflight.test.mjs | missing overlay patch fails before rewriting cordis.patch.yml | 🟢 green |
| specs/repo-layout/spec.md → R2 | 公开条目缺少源码时同样在物化前拒绝运行 | tests/sync-preflight.test.mjs | missing public skill fails before any materialization | 🟢 green |
| specs/repo-layout/spec.md → R2 | 源码经符号链接越出所属根时拒绝运行 | tests/sync-preflight.test.mjs | symlinked patch escaping its root is rejected | 🟢 green |
| specs/repo-layout/spec.md → R2 | compat 依赖目录缺失或越界时在物化前拒绝运行 | tests/sync-preflight.test.mjs | missing or escaping compat dependency fails before dependency sync | 🟢 green |
| specs/repo-layout/spec.md → R2 | 全新环境预检失败时不创建 profile | tests/sync-preflight.test.mjs | preflight failure on a fresh DSH_HOME leaves it empty | 🟢 green |
| specs/repo-layout/spec.md → R2 | DSH_LOCAL_MANIFEST 为相对路径时拒绝运行 | tests/sync-overlay-root.test.mjs | relative DSH_LOCAL_MANIFEST is rejected by sync | 🟢 green |
| specs/repo-layout/spec.md → R2 | DSH_LOCAL_MANIFEST 为相对路径时启动清单降级 | tests/sync-overlay-root.test.mjs | relative DSH_LOCAL_MANIFEST degrades the startup listing with a warning | 🟢 green |
| specs/repo-layout/spec.md → R2 | 外部 overlay 根的 local package 在该根内构建并安装 | tests/sync-overlay-root.test.mjs | external root local package builds in its own workspace | 🟢 green |
| specs/repo-layout/spec.md → R2 | 外部 overlay 根的 local package 构建失败 | tests/sync-overlay-root.test.mjs | external root build failure stops before install | 🟢 green |
| specs/repo-layout/spec.md → R2 | buildInputs 越出 overlay 根时拒绝运行 | tests/sync-overlay-root.test.mjs | buildInputs escaping the overlay root are rejected | 🟢 green |
| specs/repo-layout/spec.md → R2 | overlay 经符号链接置于仓库根 | tests/sync-overlay-root.test.mjs | repo-root overlay symlink resolves sources from the link target | 🟢 green |
| specs/repo-layout/spec.md → R2 | overlay 以相同 npm 包名顶替公开 package 时拒绝运行 | tests/sync-overlay-root.test.mjs | overlay package reusing a public npm name is rejected | 🟢 green |
| specs/repo-layout/spec.md → R2 | overlay package 与顶层 dependencies 同名时拒绝运行 | tests/sync-overlay-root.test.mjs | overlay package reusing a top-level dependency name is rejected | 🟢 green |
| specs/repo-layout/spec.md → R2 | overlay package 与 compat 依赖同名时拒绝运行 | tests/sync-overlay-root.test.mjs | overlay package reusing a compat dependency name is rejected | 🟢 green |
| specs/repo-layout/spec.md → R2 | 自动升级不改写 overlay 条目 | tests/plugin-update-overlay.test.mjs | plugin-update skips overlay rows without touching dsh.yaml | 🟢 green |
| specs/repo-layout/spec.md → R2 | 升级检查的每一行携带来源标记 | tests/plugin-update-overlay.test.mjs | every update row carries fromOverlay | 🟢 green |
| specs/repo-layout/spec.md → R2 | 升级检查按 scope 解析 registry | tests/plugin-update-overlay.test.mjs | scoped package metadata goes through npm with profile auth | 🟢 green |
| specs/repo-layout/spec.md → R2 | npm spec 与 name 不一致时拒绝运行 | tests/sync-overlay-root.test.mjs | name disagreeing with the npm spec is rejected | 🟢 green |
| specs/repo-layout/spec.md → R2 | 禁用的 overlay local package 缺少源码不阻止 sync | tests/sync-preflight.test.mjs | disabled local package without source is removed via the ledger | 🟢 green |
| specs/repo-layout/spec.md → R2 | overlay 源码缺失不阻止 reset | tests/sync-preflight.test.mjs | reset succeeds when overlay sources are gone | 🟢 green |
| specs/repo-layout/spec.md → R2 | 运行体兼容源码缺失不阻止 reset | tests/sync-preflight.test.mjs | reset succeeds when the host runtime builder is missing | 🟢 green |
| specs/repo-layout/spec.md → R2 | 禁用 local package 的 package.json 越出所属根时拒绝运行 | tests/sync-preflight.test.mjs | disabled local package.json escaping its root is rejected before reading | 🟢 green |
| specs/repo-layout/spec.md → R2 | 条目自行声明所属根时拒绝运行 | tests/sync-overlay-root.test.mjs | reserved sourceRoot and overlaySource fields are rejected | 🟢 green |
| specs/repo-layout/spec.md → R2 | 启动清单列出外部 overlay 根的 local package | tests/sync-overlay-root.test.mjs | startup listing resolves local names from the overlay root | 🟢 green |
| specs/repo-layout/spec.md → R3 | 所需 scope 已配置 | tests/sync-npm-scopes.test.mjs | configured scope passes and .npmrc is untouched | 🟢 green |
| specs/repo-layout/spec.md → R3 | 所需 scope 缺失时在变更前拒绝运行 | tests/sync-npm-scopes.test.mjs | missing scope fails before dependency and package changes | 🟢 green |
| specs/repo-layout/spec.md → R3 | 全新环境所需 scope 缺失 | tests/sync-npm-scopes.test.mjs | missing scope on a fresh DSH_HOME installs nothing | 🟢 green |
| specs/repo-layout/spec.md → R3 | npmScopes 格式非法时拒绝运行 | tests/sync-npm-scopes.test.mjs | malformed npmScopes is rejected at load | 🟢 green |
| specs/repo-layout/spec.md → R3 | 非 package 条目声明 npmScopes 时拒绝运行 | tests/sync-npm-scopes.test.mjs | npmScopes on a non-package entry is rejected | 🟢 green |
| specs/repo-layout/spec.md → R3 | scope 缺失时不迁移旧状态账本 | tests/sync-npm-scopes.test.mjs | missing scope leaves the legacy ledger unmigrated | 🟢 green |
| specs/repo-layout/spec.md → R3 | 禁用条目不参与 scope 校验 | tests/sync-npm-scopes.test.mjs | disabled entry scopes are not checked | 🟢 green |
| specs/repo-layout/spec.md → R4 | npm test 屏蔽 shell 中的 overlay | tests/test-isolation.test.mjs | npm test masks an exported DSH_LOCAL_MANIFEST | 🟢 green |
| specs/repo-layout/spec.md → R4 | 测试运行中不读取公开仓库根的 overlay | tests/test-isolation.test.mjs | a broken repo-root overlay does not reach tests | 🟢 green |

## Coverage Notes

- **Existing rows (🟢 existing).** These 10 scenarios keep their text or meaning from the archived
  `local-manifest-overlay` change and are already covered by passing tests. They are regression
  guards, so they cannot start red. During apply they must stay green. Two of them need a
  `DSH_LOCAL_MANIFEST` value that is absolute; the existing fixtures already use absolute tmp paths.
- **Shared fixture.** Add a helper (e.g. `tests/helpers/overlay-fixture.mjs`) that copies
  `scripts/sync.mjs`, `scripts/plugin-list.mjs`, and the libs it imports into a tmp public repo,
  creates a separate tmp overlay root `<R>`, and returns `{repo, overlayRoot, dshHome, run}`.
  Fold the setup in `tests/sync-local-manifest-overlay.test.mjs` into it. Use a fake `DSH_BIN`
  that records `plugin add/remove` into the profile `package.json`; follow the pattern in
  `tests/sync-local-package.test.mjs`. That lets tests assert "profile `package.json`
  byte-identical" without a real DSH.
- **"`$DSH_HOME` unchanged".** Snapshot the tree (relative path → sha256 plus the list of
  directories) before and after. Compare the snapshots. Do not compare mtimes.
- **Build cwd.** The fixture overlay package's `build` script writes `process.cwd()` to a file.
  The test asserts that the value equals `realpath(<R>)`. The fixture overlay root needs
  `package.json` with `workspaces: ["packages/*"]`. It must not run `npm install`: a
  workspace-free build script runs under `npm run --workspace` without installed deps.
- **npm scope tests.** Put the scope registry in a tmp profile `.npmrc`. Set
  `npm_config_userconfig` to a tmp empty file so the runner's `~/.npmrc` cannot satisfy the
  scope. Add one extra case: `npm_config_registry` set in the env does not count as a
  configured scope (reviewer S2). Invoke the real `npm` binary. Only `npm config get` is called,
  so this needs no network.
- **Scoped update check.** Start a local `http.createServer` registry that records the
  request path and `authorization` header. Point the profile `.npmrc` scope at it with
  `//127.0.0.1:<port>/:_authToken=test-token`. Assert that the request arrives and carries
  `Bearer test-token`.
- **plugin-update.** Inject the detection result, or point it at the local registry above.
  Run `scripts/plugin-update.mjs --yes` in a tmp git repo so the test can assert that no
  commit was created (`git rev-list --count HEAD` unchanged).
- **Test isolation (R4).** The test spawns `npm test` limited to a probe file. Implementation
  choice: add a `test:probe` script sharing the same env prefix, or pass
  `--test-name-pattern` through `npm test --`. The child runs with an exported
  `DSH_LOCAL_MANIFEST` pointing at a real file, and the probe asserts the env value it sees is
  nonexistent. For the repo-root case, the probe loads overlays with `repo: REPO` while a
  broken `dsh.yaml.local` exists in a tmp copy of the repo root. It must not create a file in
  the real checkout.
- **Host runtime split.** Keep `tests/dsh-host-runtime.test.mjs` green. The builder-missing
  error now comes from `assertHostRuntimeSources` / `loadDeclaredHostRuntime`, not from
  declaration parsing. Update those assertions without weakening them.
