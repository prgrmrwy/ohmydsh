# collab-kernel 最终独立代码审查

## 结论：PASS

当前工作树实现可通过本轮 **kernel 代码审查**。没有发现尚未修复的 Critical / High / Medium 阻断问题。历史 dispatch F1（生命周期竞态）与 F2（创建收据绕过 failed/close）已在本轮源码和独立执行的测试中闭合。有一项不阻断的 Minor 设计实现差异，见下文。

这是对当前工作文件（包含新增、未跟踪文件）的审查，不是仅对 HEAD diff 的审查，也不是 DSH 接入、真实 provider 或整个 change 发布验收结论。审查只新增本报告；没有修改产品代码、测试、tasks/spec、依赖或历史审查报告，没有提交或部署。

## 依据与可复核快照

依据为[当前规范][spec]、[设计][design]、实际 kernel 源码与测试。历史 [dispatch FAIL][dispatch-old] 和 [storage FAIL][storage-old] 原样保留；[storage 最终 PASS][storage-final] 已覆盖深层存储专项，本轮只检查其服务边界和实际全套测试结果，不重复宣称完成一次独立存储故障矩阵审计。

本轮执行前后的 [service][service] SHA-256 一致：

```text
6a140df15276fc2d023d071b599e08be80d8376d89d15bd465c4ece2d2819313
```

该快照不同于此前交接中的 `1742063d…`。最终复核的测试文件摘要：

- [service-admission.test.ts][admission]：`eb18d65a80605ed6c3fb32dc01717b4f7a06ea18aa547002cf43d1863316e129`
- [service-lifecycle-extra.test.ts][extra]：`2a7b895035e76b66b05db90c65a90d9bbe068d0de0b5639d97b4cb2ce6d8e0ac`

本轮实际结果为 **205 tests / 38 test files**，不是旧交接的 204 tests；extra 文件实际为 5 个测试，包含 service 对已接纳 commit 的独立 drain 测试。

## F1 / F2 修复核验

| 核验项 | 源码机制及实际测试依据 | 判断 |
|---|---|---|
| close 立即停止接纳，closing 期间不能 open | [service:37–73][lifecycle-code] 在任何等待之前设置 stopped、推进 epoch、撤销 generation；open 检查 closing；同空间 close 去重。[admission][admission] 覆盖挂起 store.close 期间读写与 open 拒绝。 | PASS |
| 挂起 store.open / read 不能晚发布 | open 在 store.open 和 read 返回后分别检查 epoch，失效时不发布 opened/state/generation；close 等待 opening 再关闭存储。[admission][admission] 覆盖 deferred open/read，[extra:23–38][extra-open] 覆盖 close 确实 drain opening。 | PASS |
| pending claim 不拖死 close，不在恢复后复活 | [createSpace:205–234][create-code] 捕获 epoch，排队后、list 后、claim 后、隐式 open 后检查；close 不等待业务/provider 队列。[extra:40–61][extra-claim] 在旧 claim 未结束时完成 close、open 与新 create，再释放旧 claim，旧命令以 STORE_FAILED 结束且日志只有一条。 | PASS |
| 已接纳 commit 必须先 drain | [persist:99–115][persist-code] 单独登记存储 promise，close 在 store.close 前等待它；不依赖替代 store 自带排队。[extra:78–96][extra-drain] 挂起替代 commit，确认 close 不先关闭 store、拒绝新命令，释放后重开读到已提交结果。 | PASS |
| failed / stopped 不能由历史创建收据绕过 | createSpace 的 check 在进入队列前和收据查找前执行；检查 failed、stopped 与 epoch。[admission][admission] 的 failed/close 重放场景及 [extra:15–21][extra-receipt] 通过。显式 close→open 恢复后才能取回原收据。 | PASS |
| 业务 closed 与服务 close 不混淆 | 普通命令仍在业务 closed/成员可变授权之前返回匹配收据，但在存储生命周期检查之后；[幂等测试][idempotency] 覆盖 join 后、业务关闭后、重开后的历史结果及 payload 冲突。 | PASS |
| principal 快照不丢 brand，provider.on 不共享 | [service:74–83][snapshot-code] 使用 spread 而非 structuredClone principal，并单独复制 provider.on。[extra:63–76][extra-principal] 在 presence 挂起后修改原 on.address，actor 仍是原成员。 | PASS |
| 晚到投递/旧命令不能污染新 epoch | [dispatch:127–157][dispatch-code] 在排队完成记录前核对 generation/opened/failed；command 在排队及业务计算后再检查 generation。[dispatch 测试][dispatch-tests] 覆盖 close 后旧实例回调，另有本轮同实例重开探针，见验证节。 | PASS |

没有把“给 SPI 增加 timeout/cancel”作为修复前提；provider 可以无限等待，但不得阻止 close 或在旧 epoch 追加提交。存储 open/read/commit 的 drain 与 provider 等待分开，符合当前设计边界。

## 全 API / 授权与风险面快速复核

- 17 个具名写命令与授权表一致。测试辅助器 [api-coverage][coverage] 用 TypeScript compiler API 提取真实公开可调用类型，只排除四个读方法与 open/close；注入 `unsafeWrite` 的类型夹具会被发现，不是两个手写命令数组互相比对。[授权测试][auth-tests] 另逐项检查允许与拒绝路径、拒绝后无日志新增。包入口没有公开字符串 dispatcher、任意事件写入或 dispatch completion 写入方法。
- 普通成员、create、internal 三个分支的 scope/收据/业务授权顺序分别核验；actor 来自地址反查。成员、创建地址、internal purpose 的收据 scope 有类型标签，重放不重新执行业务或投递。principal brand 是受信宿主的防误用边界，不是对恶意宿主的安全沙箱。
- [确认决定:313–330][confirm-code] 限制 active human/provider，校验注册 provider/channel、decider、请求状态与 revision、成功且有 messageRef 的匹配 delivery。actionId 在 provider 命名空间内去重；新 cmdId 的有效 action 重放只追加收据，冲突拒绝。[决策测试][decision-tests] 覆盖这些主要正反例。
- 显式条目转换表、revision CAS、不可离开的 decided/escalated 边界、request 承接方进度、第四次 agent revise 升级，结合对应测试结果检查；纯 reducer/dispatch decision 与服务业务回调分离的实际形态见 Minor。
- dispatch intent 与业务事件同提交，完成结果独立提交且无外部收据。SPI 不占串行队列；failed/业务 closed/旧 generation 不写 completion；恢复不自动重发未完成投递。wake 定向接收者、计数/熔断和 decision reset 保持在持久事件中。
- 调用输入、读结果、provider 参数有相应快照/复制；投影以转义后的纯文本呈现外部字段，约定文本与摘要固定，依赖边界测试实际执行。服务使用全量日志和线性收据检索，适用于本期有限日志、单 writer 边界；本轮不把无限日志或恶意宿主设为隐含承诺。

## 非阻断发现

### Minor M1：D2 的纯 business decide 设计与实际组织不完全一致

**位置：** [design:65–69][design-d2]、[service:168–198][command-code] 及其具名业务方法、[domain/decide.ts][decide]。

**可复核方式：** D2 描述一个接收 state/command/context 并返回事件的纯 `decide`。实际 `domain/decide.ts` 是纯 dispatch 决策；业务校验与事件生成分布在 service 的私有 callback，某些 callback 还捕获 ctx、预先认领结果或服务 records。它不是设计文字所称的单一纯业务 decide。

**影响：** 领域规则的独立测试与后续维护成本略高，设计阅读者可能误判边界。当前 callback 只能从内部具名方法提供，没有开放 arbitrary callback/事件入口；授权、receipt、generation、持久化仍集中在 command。未发现由此产生的契约破坏，因此不阻断本轮 PASS。

**最小后续处理：** 优先在后续文档维护中准确说明“纯 reducer/dispatch decision + service 私有业务 callback”的现状与约束；只有需要独立领域复用时再抽出纯 business decide。不要仅为满足抽象形式在本轮扩大重构。此报告未修改设计。

## 独立执行的验证

在目标 worktree 运行，均正常结束：

```sh
npm --workspace packages/collab-kernel test
npm --workspace packages/collab-kernel run typecheck
npm --workspace packages/collab-kernel run build
```

- Vitest：**38 files passed，205 tests passed**，无类型错误；只有 Vitest typecheck 的实验性提示。
- typecheck：生产与测试 TypeScript 检查通过。
- build：TypeScript 构建及 convention markdown 复制通过。
- 本轮另执行无文件写入的 Node 内存 store/provider 探针，使用刚构建的公开入口：
  1. 挂起 delivery，**同一个 service** close→open 后再释放旧 delivery；日志长度不变，新总览仍将它列为 pending。
  2. 挂起 setStatus 的 presence，close→open 后再释放；旧命令返回 `COLLAB_STORE_FAILED`，日志长度不变。
  两项断言均 PASS，进程正常退出。该探针补充既有跨实例晚回调测试，不声称已加入永久回归套件。

历史报告中的 pre-fix RED 由原审查留存，本轮**没有重新切换源码执行 RED**；本结论依赖当前源码检查与本轮独立 GREEN，不把 owner 的历史计数当作实测。

## 边界与移交

本报告不代替根仓库 npm test、artifact/OpenSpec strict 检查，也不代表真实 DSH/provider 接入验证；这些由主任务负责。未运行部署、安装依赖、服务重启或发布。已有 storage 专项报告保留其独立范围。若上述 service/test 摘要后续变化，应按变化重新确认本结论。

[spec]: <../../specs/collab-kernel/spec.md>
[design]: <design.md>
[dispatch-old]: <dispatch-code-review.md>
[storage-old]: <storage-code-review.md>
[storage-final]: <storage-code-review-final.md>
[service]: <../../../packages/collab-kernel/src/service/index.ts>
[lifecycle-code]: <../../../packages/collab-kernel/src/service/index.ts#L37-L73>
[create-code]: <../../../packages/collab-kernel/src/service/index.ts#L205-L234>
[persist-code]: <../../../packages/collab-kernel/src/service/index.ts#L99-L115>
[snapshot-code]: <../../../packages/collab-kernel/src/service/index.ts#L74-L83>
[dispatch-code]: <../../../packages/collab-kernel/src/service/index.ts#L127-L157>
[confirm-code]: <../../../packages/collab-kernel/src/service/index.ts#L313-L330>
[command-code]: <../../../packages/collab-kernel/src/service/index.ts#L168-L198>
[admission]: <../../../packages/collab-kernel/test/service-admission.test.ts>
[extra]: <../../../packages/collab-kernel/test/service-lifecycle-extra.test.ts>
[extra-open]: <../../../packages/collab-kernel/test/service-lifecycle-extra.test.ts#L23-L38>
[extra-claim]: <../../../packages/collab-kernel/test/service-lifecycle-extra.test.ts#L40-L61>
[extra-drain]: <../../../packages/collab-kernel/test/service-lifecycle-extra.test.ts#L78-L96>
[extra-receipt]: <../../../packages/collab-kernel/test/service-lifecycle-extra.test.ts#L15-L21>
[extra-principal]: <../../../packages/collab-kernel/test/service-lifecycle-extra.test.ts#L63-L76>
[idempotency]: <../../../packages/collab-kernel/test/idempotency.test.ts>
[dispatch-tests]: <../../../packages/collab-kernel/test/dispatch.test.ts>
[coverage]: <../../../packages/collab-kernel/test/support/api-coverage.ts>
[auth-tests]: <../../../packages/collab-kernel/test/auth.test.ts>
[decision-tests]: <../../../packages/collab-kernel/test/decisions.test.ts>
[design-d2]: <design.md#L65-L69>
[decide]: <../../../packages/collab-kernel/src/domain/decide.ts>
