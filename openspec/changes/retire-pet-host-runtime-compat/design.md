## Context

兼容运行体的唯一作用是让长期 Host 加载打过补丁的官方包。`locus-three-tier-structure` 之后只剩 team-membership 一处 roster 条件；Pet 源码（`packages/dsh-pet/src`）不读取 `DSH_RUNTIME_COMPAT` 或 `pet-unified-locus-v1`。

## Goals / Non-Goals

- Goals：长期 Host 改用官方精确运行体；删除全部 compat 源码、构建、发布和围栏逻辑；不留未使用的通用开关。
- Non-Goals：不改 `patches/*.yml`（配置组合补丁，不改源码）；不改 Pet 行为或状态；不在本变更内升级 `dshVersion`。

## Decisions

1. **整体删除而非保留空机制**：`hostRuntimeCompatibility` 只支持 local `dsh-pet`、kind 固定且 builder 路径写死在 `compat/subagent`，没有可复用的通用部分。保留会形成无主分支与依赖已删目录的测试。
2. **退役字段 fail closed**：manifest 或 overlay 再出现该字段时加载阶段报错，提示机制已退役；避免旧 overlay 被静默接受后让人误以为补丁仍生效。
3. **残余风险由所有者接受**：官方 rc.2/rc.5/2.2-rc.1 的 roster 均在 descriptor 写入前把 `origin:'subagent'` 子会话判为 Lead。影响限于短窗口内的 Team 簿记与 Lead 工具授权；Pet locus 子会话的执行期守卫继续拒绝 Team 工具。以后若需修复，按 `pet-compat-minimization` 的举证标准另立变更。

## Risks / Trade-offs

- [普通 subagent 在窗口内获得 Team Lead 能力] → 所有者接受；升级时复查官方 roster 是否修复。
- [首次切换运行体] → 受控握手重启；`no-pet-stop-plugin` 与 Pet 协议均不依赖 compat。

## Migration Plan

合入并两次生产构建后受控重启；以 `dsh history` 与启动事件中 `runtime=` 字段确认已为官方运行体，并复核 Pet 停机协议 descriptor 与鉴权 status。回滚：回退本变更提交并重新 build。
