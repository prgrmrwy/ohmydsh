## Why

sync 的部署账本文件名长期带着仓库名(`.zydsh-` → `.mydsh-` → `.ohmydsh-sync-state.json`)。仓库每改一次名,该常量被"顺手统一",已部署的账本随即成为孤儿:sync 从空 state 重新开始,丢掉全部所有权记录。多数 artifact(package / skill / preset)靠内容 hash 静默重新认领而不报错,唯独 fail-closed 的 `agentInstructions` 路径会硬失败——2026-08-24 实际表现为 `agent instructions target is unmanaged at ~/.dsh/AGENTS.md; refusing to overwrite existing content`,并连带把 launcher 的 DSH 自动升级(0.1.0-rc.7 → 0.1.1-rc.2)回滚。

同一缺陷已发生两次(`41109c1` zydsh→mydsh、`fdd1a65` mydsh→ohmydsh),两次都只改常量、未迁移已部署账本,且两次都未被立即发现——因为静默重新认领掩盖了大部分症状。根因不在 fail-closed 判定(那是 spec 要求的正确行为),而在于**账本的持久性从未被规范约束**:现行 spec 只要求 sync "记录 source 与部署内容哈希",没有规定这份记录存放在哪、其标识受什么约束、跨改名时如何延续。缺少这条不变量,该缺陷可以被任何一次无害的改名重新引入。

## What Changes

- 新增不变量:部署账本的标识必须与仓库名无关,不得随仓库更名而变化。
- 新增不变量:sync 必须在读取任何状态前迁移历史命名的账本,以延续对既有部署产物的所有权;迁移是移动而非复制,且不得删除更旧世代的账本,只报告。
- 明确 fail-closed 语义不变:账本正确延续时,既有的"未托管冲突"与"托管漂移"判定行为与现状一致。
- 非 **BREAKING**:实现已随 `1bef127` 落地并在真实部署上迁移成功,既有场景全部照常通过。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `repo-layout`: 新增一条要求,规定 sync 部署账本的标识约束与历史命名迁移语义;与既有「环境级 agent instructions 单例安全物化」的 fail-closed 场景互为前提——后者的正确性依赖前者提供的所有权记录。

## Impact

- 实现位于 `scripts/sync.mjs`:`STATE_FILE` 常量、新增 `migrateLegacyState()`、`main()` 启动顺序。
- `tests/sync-agent-instructions.test.mjs`:两条回归测试(跨改名保住所有权、多世代并存的优先级与不删除语义)。
- `tests/sync-local-package.test.mjs`、`README.md`、`docs/notes/dsh-home-agent-instructions.md`:账本文件名引用同步。
- 部署侧:既有安装在下次 sync 时自动迁移;更旧世代的账本文件保留在 `$DSH_HOME`,由用户自行删除。
- 不影响 `dsh.yaml` 契约、customization 物化流程或任何 package 运行时行为。
