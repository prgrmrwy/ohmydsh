## 1. 决策与前置实测

- [x] 1.1 撰写 `docs/adr/ADR-0008-locus-shell-tier.md`（所有者接受的风险、出站仅防误操作、委派结构性排除、回滚说明），更新 `docs/adr` 索引（若有）
- [ ] 1.2 在真实 read 档 locus 子会话等价沙箱下实测 `lark-cli --as bot im +chat-messages-list --chat-id <当前群>` 能否工作；结论写回 design.md「Open Questions」，失败则先补设计决策再继续（私有测试群外部 bot/API 检查仍返回 230027；已补 fail-closed 决策；尚非真实 child 等价沙箱实测，见 design.md）
- [x] 1.3 回归测试：`LOCUS_SAFE_TOOL_NAMES ∪ LOCUS_SHELL_TIER_TOOL_NAMES` 是 `dsh-pet-executor` 全局（可 restrict）工具集的子集，且与委派 denylist 不相交（shell 集合基于该 preset 实际挂载项：`bash`、`skill`）

## 2. 组合常量与标记

- [x] 2.1 `composition.ts`：新增 `LOCUS_SHELL_TIER_TOOL_NAMES`、`LOCUS_DELEGATION_DENYLIST`；`attestLocusComposition(visible, tier)` 按档位核验（safe 严格等价今天、shell 需含 `bash`、两档均不得含委派）；单测覆盖每个分支与泄漏报告
- [x] 2.2 `aggregate.ts`：`LocusChildComposition` 扩为 `'safe-v1' | 'safe-v2'`，`LOCUS_SAFE_CHILD_COMPOSITION` 改为 `safe-v2`；未知值仍抛 `INVALID_LOCUS`；新增可选 `toolTier` 字段与校验；新代际/重建不继承 `toolTier`
- [x] 2.3 持久层 additive 迁移：`toolTier` 与 `safe-v2` 可读写，旧行（无 `toolTier`、`safe-v1`）读为 `safe`；reconciliation 对 `safe-v1`/`safe-v2` 均视为可服务，无标记仍 invalid
- [x] 2.4 `child.ts`：持久 `toolFilter` 改为 `LOCUS_BASE_TOOL_FILTER`（safe ∪ shell-tier），确认 descriptor 与冷恢复重放路径使用同一常量

## 3. 发布边界的收紧层与 guard

- [x] 3.1 `composeLocusChild`：对 `safe-v2` 按持久档位同步安装 `tools.restrict({deny: SHELL_TIER})`（仅 safe 档），disposer 存 WeakMap；`restrict` 抛错或回读不符即 `surface-not-attested` 否决；`safe-v1` 不装层且按 safe 核验
- [x] 3.2 在同一边界为每个 `safe-v2` 子会话注册 per-agent `tools.guard`，按 design D5 拒绝 lark-cli 写动作并返回 finish 回退文案；单测覆盖 send/reply/recall/update/forward、`api POST /im/v1/messages`、引号/空白变体，以及**不**拦截 list/get 读命令
- [x] 3.3 单测：fresh staging 分支与 durable 冷恢复分支都按持久档位得到一致工具面；收紧层安装失败时拒绝发布而非以宽底座发布

## 4. 档位切换（不重建）

- [x] 4.1 新建 tool-tier mutation seam（复用 `permission-mutation.ts` 的 serialize + busy fence）：apply（撤/装收紧层）→ 回读核验 → 同一事务持久化 effective 与释放 fence；失败回到 safe 并确认回读后拒绝
- [x] 4.2 子会话不在内存时仅写持久档位，下次发布由 3.1 安装；单测覆盖
- [x] 4.3 `safe-v1` 行请求 shell 确定性拒绝并提示显式重建；入口不失效
- [x] 4.4 审计：记录 actor、时间、desired、effective；复用权限变更的记录形状

## 5. 控制面与入口门禁

- [x] 5.1 `admission.ts`：解析 `-t/--tools/--tools=` 的 `safe|shell`（畸形仍为控制命令）；非 allowlist 按 `control-not-allowed` 拒绝
- [x] 5.2 `admission.ts`：`shell` 档下 `canAskAsGroupMember=false`，新 reason `owner-only-tier`；控制器对其发送确定性回执
- [x] 5.3 派发前门禁：`shell` 档下非 allowlist `senderOpenId` 的 Delivery 以 `owner-only-tier` 结算，不投递；单测覆盖切档前已排队与切档/派发竞态
- [x] 5.4 `control.ts`：`-t` 命令接入 4.1 seam，忙时拒绝，回执含 spec 规定的后果说明

## 6. Prompt 与管理面

- [x] 6.1 `context.ts`：按档位生成能力说明；shell 档注入当前 chat_id、允许 bot 身份读取当前入口、禁止跨群/私聊/全局检索、回复仍经 finish；safe 档文案与今天一致（快照测试）
- [x] 6.2 管理面路由与 UI：展示并切换工具档位，沿用权限档控件形态；显示后果说明，MUST NOT 把 guard 称为安全边界
- [x] 6.3 更新 `docs/architecture/dsh-plugin-integration-pitfalls.md` 中 own-layer/委派逃逸条目，说明宽底座为何仍排除委派

## 7. 验证与收尾

- [x] 7.1 `packages/dsh-pet` typecheck 与测试；仓库 `npm test`、`npm run check:artifacts`、`openspec validate pet-locus-shell-tier --strict`（当前工作树重新运行；Pet 2859 passed / 43 skipped，仓库 253 passed / 2 skipped，typecheck/build/strict/diff 检查通过；证据见 `port-verification.md`）
- [x] 7.2 `node scripts/sync.mjs` 两次，第二次无变化（经所有者批准部署并重启 Host：第一次 32 changes，第二次 `no changes — deployment already matches manifest`；产物含新代码已核验。清理 worktree 前须先在 main checkout 再跑一次 sync，见 `port-verification.md`）
- [x] 7.3 实机：新建入口群即得 `safe-v2`（无需重建）→ `-t shell` 成功且回执如实声明"guard 不是安全边界" → bash 执行 `echo shell-ok` 退出码 0 → `lark-cli im +messages-send` 执行前被 guard 拒绝并原文返回 `pet_locus_finish` 指引、正文改经 finish 送达 → `-t safe` 回退且 bash/Skill 收紧。四条均有回执，见 `port-verification.md` 的 Live acceptance 表。**未复测**：授予后的重启/冷恢复持久性
- [ ] 7.4 将 delta 合入 `openspec/specs/pet-locus-collaboration/spec.md` 后归档（需用户确认）
