# 规划期基线（2026-10-24）

本记录仅描述规划与本机旧实现基线，不是新启动器实现或 Windows 支持验收。

## 当前环境与命令

- 执行位置：托管 `ws/win` worktree，Linux；Node v24.20.0，npm 12.0.2。
- `node --test tests/launcher-cli-routing.test.mjs tests/launcher-host-prerequisites.test.mjs tests/launcher-npm-env.test.mjs tests/dsh-runtime.test.mjs`
- 结果：34 tests，34 pass，0 fail，0 skip；约 8.63s。
- 追加：`node --test tests/dsh-runtime-provisioning.test.mjs tests/dsh-host-runtime.test.mjs tests/dsh-host-runtime-upgrade.test.mjs tests/host-prerequisites.test.mjs`，39 tests，39 pass，0 fail，0 skip；约 3.73s。合计相关旧实现基线 73/73。
- `npm run check:artifacts` 通过。
- manifest-notes、manifest-version-drift、local-package-peers、repo-facade 四份测试另跑 24/24 通过（不含根测试失败项）。
- 本机通过 Node shell:false 调真实 Git config 写入含双引号/空值，再 --null --get 作字节比较，确认该无 Shell alias 测试 oracle 有效；这不是 Windows 实测。
- 另跑 `node --test tests/sync-env-local.test.mjs`：11/11 通过，明确裸脚本 allow-list 解析与 launcher 全文件校验是不同兼容面；合计本轮相关基线 84/84。
- `openspec validate cross-platform-launcher --strict` 通过；`git diff --check` 通过。
- 旧升级归档时 ordinary `openspec validate --specs` 42/42 通过。strict 的既有 Purpose placeholder 问题位于 dsh-pet、dsh-runtime-provisioning、pet-locus-doc-comments，不在本次规划中顺手修正。

## 基线边界

旧 launcher routing/npm env 测试部分通过读源文本、regex 替换 server 启动命令或 Bash 包装桩来观察行为；这不能直接证明新实现跨平台，也不能把那些静态字符串断言照抄为行为契约。迁移需保留其意图，转换为可执行的外部断言。

runtime 测试使用临时监听服务和 DSH 形状的 argv 验证停止/拒绝行为，没有重启本机正式 Host。新设计增加实际入口身份核验时 fixture 必须补齐相应包结构；不因旧 fixture 的简化而放宽身份检查。

本轮没有新增依赖、npm link 到用户全局 prefix、执行根 build/sync、重启生产或 Windows 实测。较早探索回合的临时 link/cmd-shim 实验仅是可行性线索，不能替代今后在原生 Windows 的安装与命令实测。

## 完整根测试未通过

随后执行 `npm test`，退出码 1。不能将上述 84/84 子集通过写成根测试通过：

- auto-model-routing/sync-dsh-openspec/dsh-openspec-upgrade 的 fixture local build 失败；独立检查 `node node_modules/typescript/bin/tsc ... --noEmit` 证实当前 worktree 缺根 TypeScript 编译器（MODULE_NOT_FOUND），根测试的 build 亦报 `tsc: not found`。本轮不安装/修改依赖，也不为环境缺失改源代码。
- 文档治理 disposition 测试仍指向刚归档的旧目录。已将实际处置表、对应 design 表格和 BACKLOG 位置提示更新为 archive 路径；属于旧 change 归档尾项，不是启动器实现。

归档的旧路径在真实 Git index 尚未 stage 时仍由 `git ls-files` 返回，故直接运行治理测试会读不存在的旧路径。使用临时 GIT_INDEX_FILE 仅表达本轮 rename 后，4 项归档敏感检查（orphan assets、disposition/design、迁移标题唯一、相对链接）均通过，未修改用户真实 index。尝试在同一临时 index 运行整份治理 suite 会被其内部创建小仓库的 fixture 共用/改写该 index，导致 old-notes 等假失败；因此只用无 index 写入的 4 项子集作归档验收，不把该整套实验声称为绿。

实施前须在 ws promote 后恢复可复现依赖，先跑完整根基线再归因后续回归。历史报告里的源码路径或已完成任务不全局改写，只修当前机械检查使用的有效目标引用。

## 同一断言的含义

P1/P2 固定旧 Bash 的可移植外部语义；P3 更换执行 adapter 而不改这些断言。新 `.env.local` 格式、缺值参数拒绝、错误退出传播、未知监听者不算就绪、Windows 强杀和平台 UI 边界属于单列的新/修正行为，先 RED 后 GREEN，不宣称它们在旧 Bash 上已通过。
