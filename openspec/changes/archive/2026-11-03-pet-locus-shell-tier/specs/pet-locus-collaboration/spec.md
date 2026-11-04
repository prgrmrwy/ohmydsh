## MODIFIED Requirements

### Requirement: Locus 业务出站只能经受管 finish

Locus child 的飞书业务正文与撤回动作 SHALL 以 caller-bound `pet_locus_finish` 的 Host 实现为唯一受管出口；普通 assistant 文本仍不得外发。该出口在各工具档位下的保证强度 SHALL 按档位区分，并 SHALL 如实陈述，MUST NOT 把较弱档位的保证表述为较强档位的保证。

**`safe` 档（默认）**：child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径。该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，`safe` 档 SHALL 不提供 `bash`、`pwsh`、`skill`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

**`shell` 档（所有者显式授予，见「Locus 工具档位由所有者显式授予且不重建子会话」）**：child 可执行通用 shell，因而**不存在**执行 authority 层面的出站隔离。此时唯一出口 SHALL 由防误操作 guard 维持：Host SHALL 在该 child 作用域拒绝经 shell 调用 `lark-cli` 发送、回复、编辑、撤回飞书消息的命令，并在拒绝原因中指明改用 `pet_locus_finish`、finish 被拒时报告原因而非绕行。该 guard MUST NOT 在规范、管理面、飞书回执或 prompt 中被表述为安全边界；有意绕过（脚本、HTTP、复制的可执行文件）不在其保证范围内。

**任何档位**：child 的已发布能力集合 MUST NOT 含子委派或可让另一执行身份代为行动的工具（包括 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 及 agent 控制工具）。该排除 SHALL 由持久组合本身保证，MUST NOT 依赖可在运行中撤除的收紧层。

Locus child 创建和冷恢复 SHALL 使用同一份持久、不可由 parent/user preset 漂移的组合。该组合的 preset SHALL 由 Pet 在创建时显式指定并持久化，MUST NOT 从主会话当前或创建时的 preset 派生；冷恢复 SHALL mount 持久化的该 preset，MUST NOT 经父组合（`composeFrom`）重建；持久记录缺失该 preset 时 SHALL 拒绝恢复。新建/重建 child SHALL 在对应 Locus 行发布 Host 证明的 composition marker：`safe-v2` 表示持久组合为「不含委派的宽底座」且每次发布时须由 Host 同步安装按档位的收紧层；`safe-v1` 表示既有的只读持久组合。marker 只能在 child 创建成功返回后、active locus 发布时写入。`safe-v1` 行 SHALL 继续按 `safe` 档服务；缺少 marker 的旧行仍 SHALL 可被 schema/persistence 读取，但 startup reconciliation SHALL 将其置为 invalid，resolution、adoption 与 dispatch SHALL 在任何 parent/child cold resume 之前拒绝；未知 marker 值亦同。Host 无法证明所需组合（含 `safe-v2` 的按档位收紧层）已安装时 SHALL 拒绝创建、恢复或派发；MUST NOT 静默回退到继承父 preset 的 child，MUST NOT 以宽底座发布一个未安装收紧层的 `safe` 档 child。任何为满足本条所需的 DSH compatibility seam SHALL 针对 manifest 中的精确 pin 做运行时探针并 fail closed。

#### Scenario: 受管 finish 正常发送
- **WHEN** 任一档位的 child 对其已证明的 current Delivery 调用 `pet_locus_finish(reply)`
- **THEN** Host 按 durable CAS 和固定触发消息发送一次正文并记录结果

#### Scenario: shell 旁路不可达
- **WHEN** `safe` 档 child 尝试以 `lark-cli`、绝对路径脚本、`msg.py`、Python/Node/curl 或复制后的可执行文件直接调用飞书接口
- **THEN** 已发布执行 authority 不能产生飞书业务消息，且 Delivery 状态不因尝试而改变

#### Scenario: shell 档误用 lark-cli 发送被拦截
- **WHEN** `shell` 档 child 在 finish 被拒后执行 `lark-cli im +messages-send …` 或等价的回复/撤回/编辑命令
- **THEN** 该工具调用在执行前被拒绝，拒绝原因指明使用 `pet_locus_finish` 并报告 finish 的拒绝原因；Delivery 状态不因尝试而改变

#### Scenario: shell 档读取当前群不被拦截
- **WHEN** `shell` 档 child 以 `lark-cli` 读取当前入口群的历史消息
- **THEN** guard 不拒绝该调用

#### Scenario: shell 档的出站保证如实表述
- **WHEN** 所有者在管理面或飞书回执中查看 `shell` 档说明
- **THEN** 说明写明该档不存在出站隔离、防误操作 guard 不是安全边界，MUST NOT 声称业务正文只能经 finish 产生

#### Scenario: 子委派不能洗白权限
- **WHEN** 任一档位的 child 尝试通过 subagent、workflow、Ralph 或 agent message 让另一执行身份代发
- **THEN** 已发布能力集合不含这些工具；业务正文不能由另一执行身份产生

#### Scenario: 收紧层未安装时不发布
- **WHEN** `safe-v2` child 被发布（新建或冷恢复），而 Host 无法同步安装或回读核验其档位对应的收紧层
- **THEN** 拒绝发布并给出确定性诊断，MUST NOT 以宽底座发布该 child

#### Scenario: 隔离能力无法证明时不发布
- **WHEN** runtime 既不能持久固定不含委派的组合，也不能提供按档位收紧的作用域限制
- **THEN** Locus intake/child 能力保持 unavailable 并给出确定性诊断，MUST NOT 以字符串过滤或 prompt 警告宣称安全

#### Scenario: safe-v1 行继续服务
- **WHEN** 一个既有 active locus 的 child 带 `safe-v1` marker
- **THEN** 该 locus 按 `safe` 档继续服务，行为与本变更前一致，不要求重建

#### Scenario: 主会话 preset 不影响子会话工具面
- **WHEN** 主会话运行一个把委派工具注册进 agent 自有层的 preset（如 `standard`）
- **THEN** 该主会话下的 locus child 仍以 Pet 指定的 preset 创建，其已发布工具面与 Pet 自建主会话下的 child 相同

#### Scenario: 冷恢复不回落到父组合
- **WHEN** Host 重启后首次向一个 independent locus child 投递
- **THEN** runtime mount 其持久化的 preset 恢复组合，不调用父会话的组合继承；运行时不支持显式 child preset 时 locus child 能力保持 unavailable

#### Scenario: 升级前的 legacy child 不可恢复服务
- **WHEN** 一个历史 active locus 的 durable child 没有 Host attested composition marker
- **THEN** 启动恢复或派发前将该 locus 标记为不可服务并要求显式重建，MUST NOT adopt 或冷恢复该 child 后继承父 preset

## ADDED Requirements

### Requirement: Locus 工具档位由所有者显式授予且不重建子会话

每个 locus SHALL 具有一个工具档位，取值 `safe` 或 `shell`，与文件权限档（`read`/`write`）正交。所有新建、替换与重建的 locus SHALL 默认 `safe`；新代际与显式重建 MUST NOT 继承上一代的 `shell`。

`safe` 档的已发布工具面 SHALL 与本变更前的 safe composition 完全一致。`shell` 档 SHALL 在 `safe` 档之上开放通用 shell 与 Skill 加载；MUST NOT 开放任何子委派或代为行动的工具（见「Locus 业务出站只能经受管 finish」）。

档位 SHALL 仅由 allowlist 经飞书控制命令（`-t/--tools safe|shell`）或管理面改变；非 allowlist 发送者的档位命令 SHALL 按既有控制命令规则拒绝。档位变更 SHALL 仅在该入口空闲（无 current Delivery 且子会话未在运行）时生效，忙时 SHALL 确定性拒绝。变更 SHALL 在同一子会话上完成，MUST NOT 重建子会话、增加代际或丢弃子会话历史。变更 SHALL 在应用后回读子会话实际可见工具面核验：与目标档位不符时 SHALL 回到 `safe` 并拒绝，MUST NOT 回执成功。变更 SHALL 记录操作者、时间、期望值与生效值。

仅带 `safe-v1` marker 的 locus SHALL 拒绝 `shell` 授予，拒绝原因 SHALL 指明需显式重建一次以获得可切换的组合；该拒绝 MUST NOT 使入口失效或暂停。

`shell` 档生效期间，该入口 SHALL 只接受 allowlist 成员的 at 作为工作请求；非 allowlist 成员的 at SHALL 得到确定性拒绝回执，说明该入口当前为所有者专用。已在 backlog 中、由非 allowlist 成员触发的 Delivery SHALL 在派发前以同一原因结算，MUST NOT 投递给 `shell` 档子会话。切回 `safe` 后 SHALL 恢复既有的群成员提问规则。

子会话每次投递的 prompt SHALL 按当前档位说明可用能力。`shell` 档 SHALL 说明：可以 bot 身份按需读取当前入口的群消息；MUST NOT 读取无关群、私聊、全局消息或其它 workspace；业务回复仍经 `pet_locus_finish`。该说明是行为约束而非授权边界。

管理面与飞书回执 SHALL 如实说明 `shell` 档的后果：子会话可在所有者本机执行命令（写入受文件权限档约束，读取与网络不受限），可使用所有者本机的飞书凭据，入口的 allowlist 成员共享该能力，且出站约束仅为防误操作。

#### Scenario: 授予 shell 档
- **WHEN** allowlist 在一个空闲的 `safe-v2` locus 发送 `-t shell`
- **THEN** 同一子会话的可见工具面增加 shell 档工具且不含任何委派工具，核验通过后回执并记录授权；子会话 id、代际与历史不变

#### Scenario: 撤回 shell 档
- **WHEN** allowlist 在空闲的 `shell` 档 locus 发送 `-t safe`
- **THEN** 同一子会话的可见工具面恢复为 safe composition，核验通过后回执并记录

#### Scenario: 忙时拒绝
- **WHEN** 入口存在 current Delivery 或子会话正在运行时收到档位命令
- **THEN** 确定性拒绝并说明需等待空闲，不改变档位

#### Scenario: 核验失败回到 safe
- **WHEN** 档位应用后回读的工具面与目标不符
- **THEN** 回到 `safe` 并拒绝，回执给出确定性原因，不回执成功

#### Scenario: safe-v1 入口请求 shell
- **WHEN** allowlist 对一个仅带 `safe-v1` marker 的 locus 请求 `shell`
- **THEN** 拒绝并说明需显式重建一次；该入口继续按 `safe` 服务

#### Scenario: shell 档拒绝普通成员
- **WHEN** `shell` 档入口收到非 allowlist 群成员的 at
- **THEN** 不创建 Delivery 工作，回执说明该入口当前为所有者专用

#### Scenario: 切换前排队的普通成员请求
- **WHEN** 入口在 backlog 中有非 allowlist 成员的 Delivery 时切到 `shell`
- **THEN** 这些 Delivery 在派发前以「入口当前为所有者专用」结算，不投递给子会话

#### Scenario: 冷恢复保持档位
- **WHEN** `shell` 档 `safe-v2` 子会话被释放后冷恢复
- **THEN** 发布时按持久档位安装收紧层，恢复后的可见工具面与恢复前一致

#### Scenario: 重建不继承 shell
- **WHEN** 一个 `shell` 档入口被显式重建或切换来源产生新代际
- **THEN** 新代际为 `safe` 档

#### Scenario: 非 allowlist 档位命令
- **WHEN** 非 allowlist 群成员发送 `-t shell`
- **THEN** 按控制命令规则拒绝，档位不变
