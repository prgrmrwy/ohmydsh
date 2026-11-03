# 固定源码 Host 兼容运行时

[English](README.md) · 简体中文

## 当前范围

DSH 固定为 `0.2.0-rc.2`，reviewed upstream commit 为 `639ed015397290b3745d163aafe02ffee4aa3f84`。现在只保留 **team-membership**（一包）；model-display 已在主干另行退役。为兼容现有 launcher 调用方保留历史目录名，但不再生成 subagent artifact。

launcher 对 `@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-tool-subagent-control`、`@deepseek-ai/dsh-tool-workflow`、`@deepseek-ai/dsh-tool-ralph` 使用官方发布包，不复制、不 override，也不再依赖工具体前 guard 能力标记或 managed-effect owner 注解。

`locus-three-tier-structure` 一并退役 settlement-notice、inquiry-isolation、newinquiry-tools-guard、native-managed-effects、相应模板与专用 verifier。三层 Locus 改用官方默认结算通知 Pet 自有 locus 主会话、首条 prompt 的 `startContinuable`、固定 `locus-base` 父组合、live agent 或待应用权限变更，以及 `sessionQuery.observeSession` 冷读。inquiry 历史只读保留，不再续进。依据见 [design 决策 3–11 与 Risks](../../../../openspec/changes/locus-three-tier-structure/design.md)。

**明确接受风险，不宣称等价防护**：移除 tools patch 后没有工具体前的最终 scoped-guard 重判。初次 guard 与工具体之间，文件物理路径/绑定状态仍可能变化；异步 `tools/execute` 包装层以及 prepare→dispatch 并行名额等待都会扩大时间窗。所有者已接受该窗口；普通 scoped guard、restrict 层与 managed finish 分别继续执行。任务 1.5 已在实际完整预览 profile 上检查：官方 `session-checkpoint-policy` 在守卫之后、工具体之前等待会话落盘，所有者同样接受该时间窗（[审计](../../../../openspec/changes/locus-three-tier-structure/probes/full-profile-wrappers.md)）。下述编译图 verifier 不重复完整 profile 检查。

## 保留的扩展

### team-membership

`team-membership.patch` 仅替换 `@deepseek-ai/dsh-experimental-agent-team`，版本 `0.2.0-rc.2-team-membership.1`，SHA-256 `0f42cab5802bcc468ed05cdba5522abe9115cef858543d97c5300ef3d8f95bae`。active/provisioning roster 成员优先保持 teammate；其它 `header.origin === 'subagent'` 子会话在首次 descriptor 追加前不再被视作 Lead，父退出时同样成立。普通根与非 provider 的 Host fork 仍是 Lead。不改变 Session 格式、descriptor 时序或真实 Team 工具。正式 roster 修复同一未发布 descriptor 窗口，且安装图通过 Team/one-shot 隔离回归后才能退役。

## 构建与验证

从本目录运行：

```sh
node --test test-packaging.cjs ../../test/team-membership-builder.test.cjs
DSH_COMPAT_SUBAGENT_CHECKOUT=/absolute/worktree/.compat-isolated/id/upstream \
  node build-launcher.cjs --isolated-output /absolute/worktree/.compat-isolated/id/output
PET_COMPAT_TEST_GRAPH=/absolute/worktree/.compat-isolated/id/output/launcher node --test test-packaging.cjs
node verify-official-runtime.mjs --graph /absolute/worktree/.compat-isolated/id/output/launcher
```

隔离验证使用精确 commit 的独立干净 checkout，output 必须新建/空目录，且位于 compat 源与 upstream checkout 外。隔离模式不发布、不移动正式 `.launcher` 指针。单独 `build.mjs` 只生成保留的 team-membership 包；`build-launcher.cjs` 在 staging 与 rename 后的最终图上执行验证，包括 DSH `--version` 与 `npm ls --all`。两者都不是 live GUI 验收。

official-runtime verifier 拒绝额外 file override；检查七个退役 owner 是精确官方版本、共享同一物理 subagent/loop/tools；以惰性替身实际挂载 native plugins，核验没有旧 owner/capability 标记；执行普通 scoped guard 拒绝及允许对照。它不声称最终 guard 重判等价。`PET_COMPAT_TEST_GRAPH` 必须显式指定：未传时产物测试报告 skipped，不回落日常 launcher。

源码 builder 只 apply 保留的 team patch，构建 native Host addon，运行 Team 行为测试，再构建 Host face。apply 前校验哈希，退出恢复源码。上游举证读取干净 HEAD，不信任可能带 patch 的缓存工作区。成功缓存 stamp 覆盖 commit 和该 patch/template；输入改变或未知先 scrub 被忽略产物，失败不写成功 stamp。

Node 须满足 `^22.19.0 || >=24.0.0`；源码固定 `pnpm@11.7.0`，launcher 固定 `npm@11.19.0`。即使命中包缓存仍可能需要 registry；失败是失败，不是验证通过。上述命令不要求安装根工作区依赖。

## 声明、安装策略与发布

本地 Pet customization 的 `hostRuntimeCompatibility` 声明选择整个长期 `dsh web` Host 的依赖根，不是 Pet 内部局部 overlay。build/sync/plugin/config 等一次性 CLI 仍用精确官方 `dshVersion`；`DSH_BIN` 保持显式紧急覆盖。版本不匹配 fail closed，须重新审查，不能只改版本字串。

`install-script-policy.json` 是精确版本 npm 脚本审查策略。强制 project scope/strict，关闭 ignore/allow-all 绕过并剥离冲突环境变量；未知脚本版本拒绝，新增 true 许可须单独人审。框架 pin 取自 reviewed source；既有 reviewed undici pin 独立于本次退役的 Pet patches，继续保留。

共享锁覆盖源码与 launcher，只回收 inode/token/PID 一致且已证明死亡的 owner。缺失/损坏 owner 或 reclaim 残留有界等待后失败，不绕锁重建。POSIX 原子替换指针；Windows 为备份→发布→验证及失败回滚，有短暂无指针窗口。Host 准备持同锁读取 entry/version/fingerprint，返回 immutable generation。未知/dangling 指针或 next/previous/restore 残留 fail closed。保留所有 generations，清理另行处理。

fingerprint 包括 team patch/template、builders、脚本策略、锁/发布 helper 与图 verifier。旧隔离图不证明新输入。所有生成物不是真相源、不进入 Git。任一步失败保留旧正式 launcher；Host 启动不静默回退官方运行体。
