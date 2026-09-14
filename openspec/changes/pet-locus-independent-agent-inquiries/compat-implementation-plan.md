# G1 independent-v1 窄兼容实施计划

状态：补丁已实施并经父 agent 独立验证可干净应用与类型通过；**尚未构建或部署 runtime，G1 未验收**。

## 核对依据

指定不可变 launcher `eb586fe8ead9f58d0e54a8a2f527c2947acf1c1d685a9e78330716cb81b653d5-58844649-a3be-4ae2-b6c1-aa63ebcacbca` 内 `compat-packages/subagent` 的 package repository.directory、source map 路径和实际 JS。原包路径为 `packages/subagent/subagent/src/`。不以另一个 DSH checkout 猜测实现，不编辑已部署 lib。

## Patch 内容（已实施，待运行时验收）

- [x] Host-only `IdleContinuableCreateSpec.contextMode?: 'independent-v1'` 及内部 Fresh spec，runtime `supportsIndependentContinuableCreate=true`。不扩模型工具 schema/通用 startContinuable。
- [x] `descriptor.ts` 新 independent payload v5，绑定 `contextMode` + `agentPreset` 必须成对；v3/v4 保持严格旧 key，one-shot 拒新字段，旧创建仍写 v4，保留旧 payload。identity projection `stateVersion` 2→3 以重折叠之前无法识别的新 descriptor 缓存。
- [x] `continuation.ts` establishFresh 首个 await 前捕获 resolved model/provider、当前实际 composed preset id、child metadata（cwd/parentSession/delegationDepth/origin/isSeeded=false）和 delegated policy。当前 metadata 在 prepare 后捕获的竞态要一起修复，仅 opted-in 分支改变。
- [x] 明确验证 provider 对象 `inheritsParentContext===false` 且具有 prepareContinuable；independent prepare 结果禁止 seed 字段（包括 []）。preset/provider/model 缺失则 fail closed，不取 default/header/后续父配置替代。
- [x] `child-agent.ts` 提取同步 local delegation/persona/filter 安装 helper；保持旧 applyChildComposition():void、one-shot 调用语义。新增 async independent composition，校验 descriptor preset 与 child header 一致，`await agentPresets.mount(childCtx,savedId)` 后安装 local helper。不先 composeFrom，不 mount(undefined)，失败不 fallback。
- [x] materializeTracked setup 改为允许 async（官方 AgentSetup 已支持 Promise，factory 在 publication 前 await），分 independent helper/旧同步 helper。delegated policy 只在 create 安装；冷恢复不采父 policy。
- [x] 两条冷路径 resolveChildForHostOperation 和 coldResume 从 own suffix descriptor 传 contextMode/preset；不重新 prepare/选父模型/cwd。

## 原生 GUI 范围核对

GUI openSubagent 是 address/history 导航，不是第三种 agents.resume。后续 prompt 经 remote.subagents.prompt → symbol queue → continuation coldResume。通用 root API 拒 child-owned identity。故当前不需 GUI/controller 或 agent-presets 新覆盖包；依然必须在验收阶段验证 GUI 打开与发送实路。

## 真相源与构建

- [x] 修改 tracked `settlement-notice.patch`（源路径 continuation/descriptor/child-agent/index/projection），同步 build.mjs 与 build-launcher.cjs 的 patch SHA、manifest provenance 与能力检查。
- [x] 构建探针增加真实 instance marker、independent descriptor roundtrip、旧版对照；fingerprint 保持覆盖 patch/build scripts。既有固定 diagnostic runtime 不能被新产物覆盖后继续声称是相同被测对象。
- [ ] 调用现有 builder 前核对执行环境授权和 checkout 使用约束：脚本当前会操作 `.upstream` 并发布本地兼容构建，不能为了测试绕过指定 DSH checkout 约束；不自动部署到生产 home。（本轮未执行 builder）

## 构建锁前置修复

全量仓库测试发现原有 stale 回收竞态，不能忽略：一次 waiter 保存 stale 布尔值后再次读取 owner，另一 waiter 已删旧目录并有新 creator mkdir 尚未写 owner，前者可能把新的 `undefined` owner 当作旧 stale 授权删除。`tests/fixtures/pet-lock-race.cjs` 通过 fs.statSync 调度边界稳定复现 RED（先修正 macOS /var→/private/var 路径同一性，确保确实触发调度）。

修复保持第一次 owner/token/PID/inode 快照，用对应 reclaim 文件串行重验；无 owner 不再通过年龄推断死亡，遗留 reclaim 等待遵守 timeout。测试改为临时目录复制原样 source，不触碰真实 build lock。ownerless 残留恢复须先停止全部构建再由操作人员处理，README 已说明。此项改变构建 fingerprint，不自动触发构建/部署。（subagent patch SHA 已因 independent-v1 另行更新为 2149e66c…）

## RED→GREEN 核验（runtime 部分均待执行）

旧 v3/v4/one-shot 同步行为；新 v5 配对严格校验；空 preset/缺服务在 provider 前失败；延迟 prepare 中父模型/preset/cwd/policy 改变仍用原快照；两条 cold path 恢复原 preset；已删除/损坏 preset 不替代、不发模型请求；实际工具/Skill 快照、自己的多轮历史、无父标识、read/silent/cwd/approval 均核对。

选择持久 preset **id**，不承诺冻结所有 plugin/Skill 文件字节；缺 active preset 可明确不可用，不隐式引入 none/default sentinel。此接缝不需要新增产品决策。maxTokens 保持上游 per-activation 合同，不顺带持久化所有 AgentOptions。
