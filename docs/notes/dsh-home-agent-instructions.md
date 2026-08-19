# DSH_HOME 环境级指令与 sandbox 参数恢复规则

## 现象

DSH 工具 schema 会展示 `sandbox_permissions`,但展示的参数不一定适合当前 runtime。会话已是 `danger-full-access` 时仍携带该字段,可能连续收到 `not strictly wider`；approval disabled 时请求升级也不会成功。只把规则放进自定义 preset,还会复制整份官方 `standard`,形成易漂移的平行基线。

## 根因

工具参数是静态接口,实际权限由每次会话最新 runtime context 决定。preset 属于 agent roster/composition 选择面,不适合作为整个 DSH 工作环境都应看到的单例前馈。DSH 原生会读取 `$DSH_HOME/AGENTS.md`,因此环境级指导应从仓库单一源文件物化到该位置。

## 错误恢复规则

1. 默认省略 `sandbox_permissions`。
2. 只有工具真实返回 `[sandbox: file access denied ...]`,且更宽权限可以解决时,原样重试一次,请求最窄权限并给出 `justification`。
3. `not strictly wider` 表示本次参数不构成有效升级:移除权限参数再试,不要重复升级。
4. runtime 显示 approval disabled 时不升级;运行上下文变化后以最新值为准。
5. 同类参数错误连续出现时停止重试并报告。

这些是模型工作指导,不是权限授予或强制安全边界。

## 为何从 preset 改为 `$DSH_HOME/AGENTS.md`

- 官方 `standard` 自动加载,无需维护 `ohmydsh` 副本。
- 环境指令与 roster 选择解耦,所有在该 DSH_HOME 下工作的 agent 都能获得同一份前馈。
- 真相源缩为 `instructions/dsh-home.md`,由 `dsh.yaml` 顶层 `agentInstructions` 控制。
- sync 用来源与部署哈希保护所有权:未托管目标不覆盖,托管目标漂移不覆盖/不删除,写入使用临时文件后原子 rename。

## 验证方法

1. 运行 `node --test tests/sync-agent-instructions.test.mjs`,覆盖路径逃逸、首次部署、幂等、未托管冲突、漂移和安全撤销。
2. 运行 `node scripts/sync.mjs`,确认 `$DSH_HOME/AGENTS.md` 含 GENERATED/provenance 头和源文件内容。
3. 检查 `$DSH_HOME/.ohmydsh-sync-state.json` 的 `agentInstructions.source` 与 `deployedHash`。
4. 再运行一次 sync,应报告无变化。
5. 确认 `$DSH_HOME/.agent-presets/ohmydsh` 已删除,而 `$DSH_HOME/skills/dsh-sandbox-notes` 仍存在。
