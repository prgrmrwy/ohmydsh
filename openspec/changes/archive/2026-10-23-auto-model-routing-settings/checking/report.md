# 验收自测报告：auto-model-routing-settings

> 2026-10-27 证据退役：本文件保留历史任务/判定，不是当前复验。被清理的细节引用已改为 Git 对象定位；以 `git show <commit>:<path>` 读取原件。轻量结论见本 change 的 checking/summary.md，摘要不替代原始证据，也不保证外部原始资产留存。

**日期**：2026-10-23（Asia/Shanghai），Loop 1。
**Base commit**：e35fedb7a083c00a5473ef610dd61f757a6d47e0（与执行时HEAD一致）。
**设备/引擎**：PC1280×800，agent-browser 0.39.1，amr-accept。
**唯一GUI**：http://127.0.0.1:3080/ 。
**来源/Focus**：用户已确认24CP及OpenSpec spec-only；all。

## Verdict

**needs-human / BLOCKED，验收未完成，不是PASS。** 仅CP01完成；20个活跃CP因执行安全前置未绑定而未运行/未完成，另外CP21/22/23是用户明确跳过。未观测到可判定产品FAIL，不能从blocked推断实现正确或错误。执行门禁结果另见`Git历史 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-23-auto-model-routing-settings/checking/gates/execution-gate.txt`：门禁仅验证记录结构，不证明验收通过。

## 独立性

低。oracle 与实现同源，绿不等于免人工。原始确认沿用，未修改`Git历史 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-23-auto-model-routing-settings/checking/checkpoints.yaml`；本轮没有独立QA或视觉基准。

## 范围声明

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能

未提交、部署、重启、修改实现、运行UT/e2e、向下派发；不读凭据值、不动key/共享白名单/历史业务会话。

## Mock 证据

| 场景 | 状态 | 证据 | 启用方式 | CP | 用户决定 |
|---|---|---|---|---|---|
| 正常设置/env只读/目录 | not_needed | `Git历史 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-23-auto-model-routing-settings/checking/mock-discovery.md`及`Git历史 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-23-auto-model-routing-settings/checking/execution-facts.md` | 既有3080 | CP01/02/20 | 真实只读观察 |
| 固定2000ms Jev延迟 | missing | mock-discovery.md：test-only seam，无既有Host启用入口 | 未启用 | CP21 | skip，不计通过 |
| 共享列表收缩竞态 | missing | mock-discovery.md：无隔离原生动态列表 | 未启用，不改共享名单 | CP22 | skip，不计通过 |
| 不兼容effort能力 | missing | 真实7模型均五级，UT fixture非现网 | 未启用 | CP23 | skip，不计通过 |

### Surface × 数据态覆盖

| Surface | 数据态 | Trail | 状态 | 缺口 |
|---|---|---|---|---|
| 设置凭据 | env-readonly | T1 | CP01 pass | 不含key修改/迁移 |
| 页签与编辑草稿 | two-provider-drafts | T1 | blocked-not-run | 未编辑草稿/核验默认 |
| info与主子候选 | criteria/current-allowlist | T1 | partial observation，非PASS | 仅simple tooltip与settings相等，目录7/白名单7；未逐四档/全部菜单 |
| 官方主模型与请求 | explicit/default/next-request | T2/T9/T6 | blocked-not-run | 实际尝试计数/取消/恢复未绑定 |
| 子工具派发与请求 | explicit/distinct/no-max | T3 | blocked-not-run | 无工具或child样本 |
| cap及稀疏默认 | conflict/repair/reset | T4/T10 | blocked-not-run | 写前原字节与恢复前提未绑定 |
| 新旧验收会话 | fresh-auto/existing-manual/manual-tool | T5 | blocked-not-run | 无本次物化session |
| toast/hover | on/off/new-decision | T2/T6 | blocked-not-run | 无新判档 |
| 设置输入校验 | invalid/boundaries | T7 | blocked-not-run | CP19整个负例/边界矩阵未执行 |
| Host Jev延迟 | fixed-2000 | T8 | user-skipped | missing mock |
| 共享列表竞态 | shrink-race | T8 | user-skipped | missing mock |
| 子模型effort | incompatible | T8 | user-skipped | missing mock |

## 执行策略

推荐single_only，用户选择single_agent。授权原文：“确认开始，当前无其他 AUTO 任务”，授权日期2026-10-23。共享全局配置、官方默认和浏览器profile，故不并发；仅本专用执行agent，无下派。费用阈值、安静窗口、非密钥byte恢复和官方当前/默认恢复授权均记录于`Git历史 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-23-auto-model-routing-settings/checking/plan.yaml`，不重复请求。

## 期望来源缺口

没有新增expected_unverified期望，未改变oracle。原独立性低且此前lint87.5%。Host→provider/Jev线级来源未核验，9个网络断言维持expected_url=null/network_assertion_enabled=false；不能拿浏览器RPC、芯片、工具或官方request/header.config当线级证据。未因预检停止而升级partial为pass。

## Loop 1

### 声明 × 证据 × 缺口台账

结果从trail聚合：**1 pass、0 fail、23 skipped**；其中20个skipped的语义为**blocked-not-run/未完成**，仅3个是用户决定skip。checkpoint result schema不支持blocked，因此保留result=skipped并明确execution阻塞，trail status=blocked；不得按23个用户skip、或已执行23项解释。不计算覆盖通过率。

| CP | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| CP01 | env key只读不预填不回传 | T1 | pass | `Git历史 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-23-auto-model-routing-settings/checking/execution-facts.md`：HTTP200；key仅四个状态字段；DOM禁用且空 | 无key写入/迁移 |
| CP02 | 草稿不改真实/default | T1 | blocked-not-run | 事实：未编辑/保存 | 默认独立快照未绑定 |
| CP03 | 主精确effort请求 | T2 | blocked-not-run，partial保留 | 事实：未发送 | 无真实请求/线级 |
| CP04 | 另一模型缺省 | T9 | blocked-not-run，partial保留 | 事实：未发送 | 无真实tier/request |
| CP05 | AUTO模型不变且官方一致 | T2 | blocked-not-run，partial保留 | 事实：未发送 | 无AUTO请求 |
| CP06 | 保存下一请求生效 | T6 | blocked-not-run，partial保留 | 事实：未保存/发送 | 无下一请求 |
| CP07 | 子工具精确组合 | T3 | blocked-not-run | 事实：工具0 | 无结构结果 |
| CP08 | 子不继承main | T3 | blocked-not-run，partial保留 | 事实：child0 | 无子请求 |
| CP09 | 官方派发参数与门禁 | T3 | blocked-not-run，partial保留 | 事实：child0 | 无派发 |
| CP10 | 降cap冲突拒绝 | T4 | blocked-not-run | 事实：保存0 | 未构造冲突 |
| CP11 | 同提交修复 | T4 | blocked-not-run | 事实：保存0 | 未提交 |
| CP12 | 缺省受cap | T10 | blocked-not-run，partial保留 | 事实：发送/工具0 | 无请求 |
| CP13 | 删除稀疏覆盖 | T4 | blocked-not-run | 事实：保存0 | 未重置 |
| CP14 | 新AUTO首请求 | T5 | blocked-not-run，partial保留 | 事实：物化session0 | 无判档 |
| CP15 | 自建旧MANUAL不翻转 | T5 | blocked-not-run | 事实：物化session0 | 未修改默认 |
| CP16 | MANUAL直通工具 | T5 | blocked-not-run，partial保留 | 事实：发送/工具0 | 无工具或零外发证明 |
| CP17 | 提示关hover存在 | T2 | blocked-not-run | 事实：无新decision | 未连续观察toast |
| CP18 | 提示开新toast | T6 | blocked-not-run | 事实：无新decision | 未触发 |
| CP19 | 设置负例与边界 | T7 | blocked-not-run | 事实：保存0 | 全矩阵未运行 |
| CP20 | criteria与候选 | T1 | 未完成，非PASS | 事实：simple tooltip与settings一致、目录7 | 其余三档及菜单集合未验证 |
| CP21 | 固定延迟 | T8 | user-skipped | 用户决定及missing mock | 未覆盖 |
| CP22 | 共享列表竞态 | T8 | user-skipped | 用户决定及missing mock | 未覆盖 |
| CP23 | 不兼容effort | T8 | user-skipped | 用户决定及missing mock | 未覆盖 |
| CP24 | 实际AUTO/child无max | T3 | blocked-not-run，partial保留 | 事实：请求样本0 | 不做空集PASS |

### 阻塞的 Trails

T1预检仅完成CP01；T2/T9/T6/T3/T4/T10/T5/T7没有启动实际动作链。未绑定可信实际尝试含重试计数、本次session取消/空闲、默认选择稳定恢复以及真实config原字节基线。因此按合同不付费、不写全局配置。源码已有cancel/selectModel候选不等于本轮端到端绑定成功；selectModel后台保存默认的void行为尤其不能忽略。初次认证门禁随后消失，不能再把认证当最终唯一阻塞。

### 调用预算与恢复

本执行者发起Jev主0/工具0，主模型0/子模型0，child创建0，saveSettings0/setKey0/selectModel0。预计8/13及停止10/20未消费，不是Host全局账单或自动尝试硬计数证明；未将当前执行agent本身的推理混入产品trail计数。

没有写Host配置，所以未创建非密钥备份，也未进行byte回滚。原config路径/hash/存在性/mode及独立默认前后值未绑定，**不宣称已hash验证完整环境恢复**。只读退出证据为00:47:09设置关闭、当前新会话MANUAL/Sol Medium前后一致、composer空；未物化本次session、无本次在途运行需取消。不碰旧业务会话、不删除历史。截图未生成，无外部截图持久性承诺。

### 未覆盖 / 天然盲区

20个活跃CP未完成；三项用户skip；Host模型/Jev线级及MANUAL零外发；同回合缓存失效、跨Host重启、受控门禁拒绝、稀疏能力/候选空、主子目录差集、全tier/model穷举；无视觉/IME新增oracle，无性能或竞态保证。没有付费试探、没有为缺证重试。继续前应由主会话解决既有计数/取消/稳定恢复绑定，不以schema存在或门禁结构PASS代替安全前置。

## Loop 2 — 真实执行，已恢复，partial / needs-human

**2026-10-23 01:16–01:29 Asia/Shanghai；HEAD未变；既有3080/amr-accept；授权沿用。** 本轮已绑定官方真实入口并完成所有付费trail，旧Loop1「无计数/取消/恢复入口」不再是当前阻塞。**最终不是PASS，也不是全局BLOCKED：3 pass、0 fail、18 manual(partial/未覆盖)、3 user-skipped。** manual仅为执行结果schema下保守承载partial，不表示18项都是天然不可自动化。独立性仍低，oracle 与实现同源，绿不等于免人工。详见[Loop2执行事实](<execution-facts.md#L41>)。

### 声明 × 证据 × 缺口台账

| CP | 本轮结果 | 声明与实际证据 | 剩余缺口 |
|---|---|---|---|
| CP01 | pass | env key只读，DOM disabled且空，settings仅状态元数据 | 不含key写入 |
| CP02 | partial | Claude/Haiku与GPT/Sol simple草稿medium跨页保留，关闭不保存，hash/default不变 | 指定Opus/Fable编辑模型切换未覆盖 |
| CP03 | partial | T2 Sol四档medium，decision14 simple，官方seq18 Sol/medium | provider线级 |
| CP04 | partial | T9 Sol显式low对照，Luna无覆盖，simple实际medium符合起点 | provider线级 |
| CP05 | partial | T2发送前/后官方选择与header三元组一致且provider/model不变 | provider线级 |
| CP06 | partial | T6保存medium→high后下一请求seq49确为high | 线级、同回合缓存分支 |
| CP07 | partial | T3实际tool/result seq69为codex/Astra/low/simple，非错误，官方派发同三元组 | 持久事件仅rendered text，无raw结构化返回，不凑full PASS |
| CP08 | partial | 主Astra/high、唯一child header Astra/low，child成功 | provider线级 |
| CP09 | partial | 官方subagent seq73参数完整同工具三元组，一child成功，无替换/重试 | 线级、门禁拒绝分支 |
| CP10 | partial | Host降cap返回400及两格effort-cap，拒绝前后hash相等 | UI两格冲突/禁用未覆盖 |
| CP11 | pass | 同提交cap及主/子两格修复medium成功，磁盘与settings精确回读 | 本有限组合之外未穷举 |
| CP12 | partial | cap low、无覆盖；Luna主header low，工具Luna/low | 线级、稀疏能力/候选空 |
| CP13 | partial | null删除主Opus/complex及子codex/complex后稀疏映射消失 | 指定两simple格UI恢复默认与回显未覆盖 |
| CP14 | partial | 新根初始AUTO，空history，首发decision21 simple/low，官方Sol/low成功 | 目标GUI芯片、Jev线级 |
| CP15 | partial | 已物化本次旧根default变AUTO后state仍MANUAL | 重新打开GUI旧根芯片 |
| CP16 | partial | MANUAL官方Sol/medium，tool/result非错默认委派文案，decision/history不增加 | raw结构、线级与零Jev外发 |
| CP17 | 未覆盖 | toast关、新decision成功 | GUI未切到目标session，observer无事件不算PASS；hover未完成 |
| CP18 | 未覆盖 | toast开、新decision成功 | GUI非目标session，不据无toast判功能FAIL；瞬态未观察 |
| CP19 | pass | UI清空保存禁用，19负例每个400+issues+hash不变；1000/4500各保存整数并立即原bytes恢复 | 不验证期限实际延迟（CP21 skip） |
| CP20 | partial | 真实目录7/允许7，四级effort菜单；此前simple tooltip原文相等 | 四档tooltip及两体系全部主子菜单未完成 |
| CP21 | user-skipped | 沿用用户跳过 | 原生固定延迟mock missing |
| CP22 | user-skipped | 沿用用户跳过 | 列表收缩竞态missing |
| CP23 | user-skipped | 沿用用户跳过 | 不兼容能力missing |
| CP24 | partial | 6个AUTO主回合的9个成功settlement与1成功child官方config未见max | provider线级、全tier/model穷举 |

### Surface × 数据态覆盖（Loop2增量）

| Surface | 数据态 | 本轮实际覆盖 |
|---|---|---|
| settings key/draft | env只读、两体系simple草稿 | key pass；草稿跨页有观察，编辑模型切换不足 |
| main official request | explicit medium、Luna default、next high、cap low | 全部取得关联官方header与成功settlement，线级仍partial |
| child tool/dispatch/request | distinct main high/child low、single child | 官方tool-call、结果、child官方header及成功1step；raw结构和线级缺口 |
| cap save | 双格冲突拒绝、同提交修复、稀疏删除 | Host观察充分；UI conflict/reset缺口 |
| session modes | 本次旧MANUAL、新AUTO首发、MANUAL工具 | state/官方请求已观察，目标GUI芯片不足 |
| toast/hover | off/on | 实际判档有样本但错误GUI会话，不计通过 |
| validation form/save | 19非法值、1000/4500 | pass，逐项hash与恢复 |
| timeout/race/incompatible | 用户三skip | 未运行 |

### 执行策略、调用预算与恢复

仍为用户批准single_agent，未向下委派执行器；产品验收会话仅创建**一个**官方child。Jev主6+工具2=**8/10**。模型主成功11+child1=12，另标题辅助请求2保守并入，**14/20**；失败assistant/attempt=0。不再新增付费请求。计数是官方settlement/辅助请求及源码无Jev重试佐证，不是Host内部provider线级硬配额，不能保证adapter内部重试完全可见。

所有链在3分钟内完成finally，最长观察至稳定恢复不足50秒；无重新付费、无为凑tier重试。每trail config准确原bytes/hash/mode恢复；最终SHA256 `dc3cd05852d22e9b92fd70bdc59bc593425e74b263baa7948df58015309176e5`，0600；官方default与profile特定agent-default-model块均Sol/medium，两个根next Sol/medium、MANUAL，3个本次session running=false。child保留其请求Astra/low且idle，不把历史lastUsed伪造为恢复值。私有0700备份保留供lead复核，不提交raw history或秘密。设置已关闭，无部署/重启/实现修改/UT/e2e。

### 未覆盖 / 天然盲区（Loop2最终）

provider/Jev线级、adapter内部重试、MANUAL零出站、raw工具结构化值、toast/hover目标会话瞬态、全部菜单/四tooltip、UI cap冲突和reset后果、重新打开旧根GUI芯片、指定Opus/Fable编辑模型切换。CP21/22/23仍用户skip；受控门禁拒绝、同回合缓存失效、重启、稀疏能力和全档穷举未覆盖。不将这些缺口反推产品bug，也不将有限官方配置样本升级为全自动通过。

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能

**门禁**：最终执行gate输出见`Git历史 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-10-23-auto-model-routing-settings/checking/gates/execution-gate-loop2.txt`；结构PASS不等于产品PASS。
