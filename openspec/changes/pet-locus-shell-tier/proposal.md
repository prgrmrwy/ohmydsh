## Why

Locus 子会话当前只有 `read/read_image/glob/grep/web_search` 与 caller-bound Pet 工具，连当前群的历史消息都读不到，所有者把 bot 拉群后几乎无法让它实际干活。这套收紧源于两个真实风险——群内任意成员借 `bash` 使用所有者本机与飞书凭据、finish 被拒后模型经 `lark-cli` 旁路直发导致 Delivery 账目错乱（`2026-09-19-pet-locus-delivery-safety-hardening`）——但它对**只有所有者驱动**的入口同样生效，代价与收益不成比例。所有者已明确选择：为可信入口提供一个显式授予的「shell 档」，并接受由此带来的安全取舍（见 ADR-0008）。

## What Changes

- 新增按入口的**工具档位**（与既有文件权限档 `read/write` 正交）：`safe`（默认，与今天完全一致）与 `shell`（开放 `bash` 与 `skill`）。**任何档位都不开放子委派**（`subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 及 agent 控制工具）。
- 档位切换**不重建子会话**：子会话的持久组合改为「宽底座（永不含委派）」，由 Pet 在每次发布（新建与冷恢复）时同步安装按档位的收紧层；切换时仅安装或撤除该层并回读实际工具面核验。
- 新的持久组合标记 `safe-v2`。既有 `safe-v1` 子会话继续在 `safe` 档服务、不受影响；对其授予 `shell` 被确定性拒绝并提示需重建一次。
- `shell` 档期间，入口**只接受 allowlist 成员**驱动工作；普通群成员的 at 得到确定性拒绝，已排队的非 allowlist Delivery 在派发前被拒绝结算。
- `shell` 档下「业务出站只经 finish」从执行权限隔离降为**防误操作**：Pet 在子会话作用域注册工具 guard，拒绝通过 `bash` 调用 `lark-cli` 发送/回复/撤回/编辑飞书消息的命令，并在拒绝原因中给出 `pet_locus_finish` 回退路径。规范与界面 MUST NOT 把该 guard 表述为安全边界。
- 子会话 prompt 按档位说明可用的读取方式：`shell` 档允许以 bot 身份读取**当前入口**的群消息，仍禁止跨群、私聊与全局检索（prompt 约束，非边界）。
- 档位由 allowlist 经飞书控制命令 `-t/--tools safe|shell` 或管理面切换，仅在空闲时生效，记录操作者、时间、期望值与生效值；新代际与重建 MUST NOT 继承 `shell`。
- **BREAKING（规范层）**：`Locus 业务出站只能经受管 finish` 由无条件的执行 authority 隔离改为按档位表述；`safe` 档保持原有全部保证。

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pet-locus-collaboration`: 修改「Locus 业务出站只能经受管 finish」为按档位的出站约束与 `safe-v2` 组合标记；新增「Locus 工具档位由所有者显式授予且不重建子会话」需求（档位语义、授予/撤销、allowlist 驱动门禁、guard、审计与迁移）。

## Impact

- Pet Host：`packages/dsh-pet/src/host/locus/{composition,child,aggregate,admission,control,context,policy-verification,permission-mutation,management}.ts`、`src/index.ts` 的 `agent/created` 组合接缝与 `visibleTools` 核验、Delivery 派发前门禁、管理面路由与 UI。
- 持久层：Locus 行新增可选 `toolTier` 与 `safe-v2` 标记，审计记录档位变化；仅做 additive 迁移，旧行保持可读。
- DSH runtime：依赖上游公开的 agent-scoped `tools.restrict()`（交集语义、返回 disposer）与 `tools.guard()`；不新增 compat patch。
- 文档：新增 `docs/adr/ADR-0008-locus-shell-tier.md`；更新 `docs/architecture/dsh-plugin-integration-pitfalls.md` 中「委派是一等逃逸面」相关条目的适用范围说明。
- 安全：`shell` 档把所有者本机 shell（受文件沙箱约束的读与网络不受限）与其飞书身份交给 allowlist 驱动的模型；群内消息内容仍作为不可信输入进入上下文。
