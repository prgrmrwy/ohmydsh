## Verification

| 检查 | 命令 | 结果 |
|---|---|---|
| 包测试 | `npm test --workspace=dsh-magpie-connector` | 34 files / 248 tests 通过 |
| 包 typecheck/build | `npm run typecheck --workspace=dsh-magpie-connector`、`npm run build --workspace=dsh-magpie-connector` | 通过 |
| AUTO 依赖方 | `npm test --workspace=dsh-auto-model-routing` | 33 files / 262 tests 通过 |
| 出口守卫依赖方 | `npm test --workspace=dsh-home-network-model-guard` | 12 files / 97 tests 通过 |
| 侧边栏依赖方 | `npm test --workspace=dsh-sidebar-session-provider-icon` | 5 files / 68 tests 通过 |
| 文档治理 | `node --test tests/repo-docs-governance.test.mjs tests/repo-facade.test.mjs` | 44 tests 通过 |
| OpenSpec | `openspec validate magpie-connector-rename --strict` | valid |
| Archify 图 | `archify finalize architecture … --quality showcase`（zh 与 en 各一次） | validate/deliver/check/browser-check 全 pass |
| GIF 尺寸 | `stat -c %s docs/settings.gif docs/model-picker.gif` | 346648 / 349420 bytes（均 < 400 KiB） |

隔离实例证据：`/tmp/magpie-demo` 下的独立 `DSH_HOME`（端口 3199）与本机 mock Magpie 网关；录屏与架构图均不含真实 key、地址或账号。生产部署的重新验收按用户要求延后：manifest 中 connector 条目仍为 `enabled: false`。
