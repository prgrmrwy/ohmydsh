## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: fresh-context subagent（同模型 deepseek-v4.1-flash；本机 `command -v codex claude gemini cursor-agent opencode` 全部 not found，因此未采用 Anvil 首选的跨模型评审，按 failure handling 落到 option 2 本地新上下文评审，如实记录）
- **Tool restrictions**: 只读：`read/grep/glob` + `bash` 只读命令（`cat/sed/grep/ls/find/head/tail/wc/diff/sha256sum`、`openspec validate|status|show|instructions`）+ `node -e` 只读事实核验；未运行测试/构建/安装、未联网、未启停 DSH；唯一写入是本报告
- **Artifacts reviewed**: `proposal.md`、`design.md`、`specs/dsh-magpie-connector/spec.md`、`specs/magpie-access-auth/spec.md`、`specs/magpie-line-selection/spec.md`；当前规范基线 `openspec/specs/{dsh-magpie-connector,magpie-access-auth,auto-model-routing,home-network-model-guard,sidebar-session-provider-icon}/spec.md`；实现 `packages/dsh-magpie-connector/src/{host,client}/**`、`test/**`、`package.json`、`README.zh.md`、`CHANGELOG.md`、`docs/**`；背景 `BACKLOG.md` D014、`openspec/changes/archive/2026-10-27-magpie-cloudflare-access/`、`openspec/changes/archive/2026-10-27-add-dsh-magpie-plugin/{test-plan.md,review.md}`
- **Artifact hashes (sha256sum，评审时刻 2026-10-28 21:35 +08:00)**：

```text
711404fb8cdf9b04888e9a9afd57ae33dbc9b7f9a6a6f90166efee0eb370392c  proposal.md
273316a11f4d082278cdd432afe55a94e265a28e71e56dce407a9d68070e1926  design.md
7f014dbcac145db2294fa1f23787a186a5dd4e5fd51e3742af31b44563a889e0  specs/dsh-magpie-connector/spec.md
3abe69d79c96548f9483144b333668a5ff260463d9a0f9a85f7cf12a9ec82004  specs/magpie-access-auth/spec.md
d4bbacb78278fc591cc0526588443e1460f0a16e1986f3dcbed0c5996b92a979  specs/magpie-line-selection/spec.md
```

- **STALENESS**: 本判定只对以上哈希对应的制品内容有效。之后除应用「修复方向」外的任何编辑都会作废本 verdict，必须重开一轮完整评审。
- `openspec validate magpie-dual-lines --strict` → `Change 'magpie-dual-lines' is valid`；评审前 `openspec status --change magpie-dual-lines --json` 显示 review 缺失、test-plan/tasks 未生成，符合当前阶段。该 change 目录在 git 中为 untracked（`?? openspec/changes/magpie-dual-lines/`），未混入其它工作区改动。

## 评审方法与只读核验

完整重读四份待评审制品、两份当前规范基线、相关源码/测试/发布文档，并沿运行时黄金路径逐条核验 design 的引用与假设；不是 diff review。除静态阅读外，用只读实验核验了两个会影响 spec 可满足性的 Node 事实（Node v24.12.0，与 `engines.node >=22.19` 同代）：

1. `net.connect({host, port, timeout: 600})` 在 DNS/建连未完成时只发出 `'timeout'` 事件，**不会**自动 `destroy`/reject；未处理的 lookup 会继续，`socket.connecting` 仍为 `true`。只写这一个选项无法满足「单条超时 ≤600ms」。
2. `new URL('http://[::1]:3425/v1').hostname === '[::1]'`，而 `net.connect({host: '[::1]', port})` 报 `ENOTFOUND`；按 `URL.hostname` 直接探测会让 IPv6 字面量线路被误判不可达。

局限：未运行 `npm test`/`npm run build`/`openspec archive`，未部署、未重启、未读取任何凭据文件；`/v1/models` 在两条线路下是否一致等真机事实只能按 design「Open Questions」对待，不冒充已验证。security 相关结论均按 fail-closed 方向要求，不因本地 mock 可绿而降格。

## Findings

### 🔴 Critical (blocking)

#### C1 — 连接身份的定义自相矛盾，且与 design 的决策相反（「线路集合」vs「只算生效线路」）

- **位置**：[connector spec:107–111](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L107-L111>)（身份=全部线路集合、添加/删除线路是身份变化来源）、[connector spec:113–118](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L113-L118>)（身份变化→立即不可见、不得回退、换代后立即同步）、[connector spec:120](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L120>)（非生效线路变化/排序不变时不得清目录，自动切线路时把上一代目录作为新代初始缓存）、[design:87](</openspec/changes/magpie-dual-lines/design.md#L87>)（身份指纹 `hash(lineId, baseUrl, accessMode, keyFingerprint, accessFingerprint)`，**只算生效线路**）、[design:92](</openspec/changes/magpie-dual-lines/design.md#L92>)（仅非生效线路变化→不换代、不清目录、不触发重同步）。
- **问题**：同一 change 对「连接身份」给出三种互斥语义：
  - (a) 身份 = **全部线路集合**（spec L107），因此 L109–110 把「添加或删除线路」明确列为身份变化来源；按 L113–118，这必须换代、立即让上一代目录/卡片不可见、且不得用上一代数据回退、并立即重新同步；
  - (b) 身份 = **生效线路指纹**（design L87），添加一条备用线路（非生效）不换代；
  - (c) spec L120 又规定「仅修改非生效线路 / 排序但生效线路未变」**不换代、不清目录**，与 (a) 直接冲突。
  典型不可同时满足的例子：新增一条备用线路（非生效）。按 spec L110 它是身份变化，必须按 L113–118 换代并立即隐藏旧目录并重新同步；按 spec L120 与 design L92 则必须不换代、不清目录、不重同步。另一个例子：自动切线路是身份变化，按 spec L114「不得用上一代的数据回退」与 L115「立即使上一代目录不可见」，但 L120 又要求「把上一代的目录作为新代的初始缓存保留（模型列表不得变空或闪断）」——「继承」与「不得回退/立即不可见」没有写成显式例外。实现者只能二选一，后续 test-plan 也无法同时映射这些场景。
- **证据**：当前基线身份定义是「规范化地址 + key」（[baseline spec:66–80](</openspec/specs/dsh-magpie-connector/spec.md#L66-L80>)），换代即清目录是既有语义；本次新增的继承/非生效例外只写在 L120 一段，没有回头改写 L107/L109–118 的身份定义。design D5 内部自洽（[design:87–96](</openspec/changes/magpie-dual-lines/design.md#L87-L96>)），说明作者真实意图是 (b)+(c)，spec 的 L107–118 是旧语义残留。
- **最小修法（需作者确认语义，非纯文案）**：
  1. 把 L107 改为「连接身份 = **生效线路**的稳定 id + 地址 + 接入方式 + 该线路 key/Access 指纹；线路集合与顺序属于选择配置，单独变化不构成身份变化」；另立「设置版本」概念描述偏好/线路列表变化。
  2. 把 L109–111 的来源改写为「生效线路的连接配置/凭据变化」与「任何线路凭据引用的外部更新（是否换代取决于是否为生效线路）」；把非生效线路的添加/删除/编辑从身份变化来源里移出。
  3. 把 L113–118 的「立即不可见/不得回退」限定为「生效线路身份变化且**不属于目录继承情形**」；把 L120 的继承写成显式例外（只允许继承目录初值，不得把继承值当作同步成功、不得跨代提交晚到响应，卡片仍清空）。
  4. 同步 design D5/Risks，并补两条场景：非生效线路凭据事件 → 不换代、不清目录、不触发同步；生效线路地址/key 变化 → 沿用旧语义（换代、不继承、清空目录）。

#### C2 — 生成「捕获值跑完」与「连接阶段失败透明换线」互斥；且「请求未发出」的证明不成立，重放可能造成一次生成两次完整提交

- **位置**：[connector spec:122](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L122>)（`prepareCall` 捕获生效线路地址/key/Access 与模型能力；后续 `stream` SHALL 只使用捕获值，不重新解析凭据、不重新读取地址；线路切换或换代 SHALL NOT 中止生成，它们**按捕获值跑完**）、[connector spec:144–148](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L144-L148>)（已准备调用按捕获值跑完场景）、[line-selection spec:69](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L69>)（连接阶段失败「MAY 换下一条可达线路重试一次」）、[line-selection spec:101–105](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L101-L105>)（生成在线路 1 被拒后改用线路 2 并**完成生成**的场景）、[design:120–122](</openspec/changes/magpie-dual-lines/design.md#L120-L122>)（D8：`fetchFor(identity)` 在拿到响应头之前抛错才允许换线；「生成请求即使换线也只会向网关发出一次完整请求（第一次请求未发出）」）、[design:93](</openspec/changes/magpie-dual-lines/design.md#L93>)（adapter/cards 改用 `op.baseUrl`/`op.key`）。
- **问题 1（同 change 两条 requirement 互斥）**：一次生成要么按 connector L122 只用捕获的线路 1 身份（连接失败就失败返回），要么按 line-selection 场景在证明未发出后改用线路 2 身份继续（这必须重新构造一次身份/地址，违反「stream SHALL 只使用捕获值，不重新解析凭据、不重新读取地址」）。此外 L69 用的是 MAY，而 L101–105 场景把「改用线路 2 并完成生成」写成必现 THEN——OpenSpec 场景是 requirement 的例证，MAY 与必现场景互相矛盾。实现和 test-plan 无法同时满足。
- **问题 2（安全/正确性：可重放判据错误）**：「拿到响应头之前抛错」≠「请求未发出」。`ECONNRESET`、`UND_ERR_SOCKET`、对端关闭等错误可以发生在请求字节已经发出、服务端已收下请求之后（连接被重置/网关断开），design L120 把它们列为可换线 cause code，L121 进一步宣称「第一次请求未发出」——这是错误推断。此时在线路 2 重放会向网关二次提交同一次生成（重复计费/重复处理；即使客户端只用第二次结果，网关侧也确实收到了两次完整请求）。只有 DNS/建连阶段错误（`ENOTFOUND`/`EAI_AGAIN`/`ECONNREFUSED`/连接超时）才足以证明请求未发出；`ECONNRESET`/`UND_ERR_SOCKET` 不满足。
- **证据**：当前实现的生成只跑一次请求，重试明确交给 DSH（[adapter.ts:172–185](</packages/dsh-magpie-connector/src/host/adapter.ts#L172-L185>) 注释「One attempt per call: DSH's llm-retry owns retries」、[adapter.ts:61–67](</packages/dsh-magpie-connector/src/host/adapter.ts#L61-L67>) `RETRY_POLICY`、baseline spec [304–314](</openspec/specs/dsh-magpie-connector/spec.md#L304-L314>)）；baseline 的捕获语义见 [baseline spec:80–82](</openspec/specs/dsh-magpie-connector/spec.md#L80-L82>)。顺手实测的 Node 行为（见「评审方法」）说明 transport 层的「事件」并不能自动等价为「连接未建立/请求未发出」。为这个极罕见的 connect-stage 失败引入生成重放，与既有 `llm-retry` 分工重复，属于高风险低收益。
- **最小修法（推荐，便宜且与既有不变量一致）**：
  1. **删除生成路径的透明换线**：D8 缩为「连接阶段失败时失效该线路探测缓存，让下一次操作重新选择」；保留「其它失败不重放、重试交 DSH」。
  2. line-selection L69 删除「MAY 换下一条可达线路重试一次」，删除 L101–105 场景，改补「连接阶段失败时线路 1 的缓存失效，下一次操作重新探测并改走线路 2」场景（不涉及已发出请求的重放）。
  3. proposal L9/design D8 同步；对外承诺保持「插件从不自行重放已发出的生成请求」。
  若产品坚持保留生成换线，必须：把 `prepareCall` 的捕获对象改为「候选线路集合 + 每线路已解析凭据」，改写 connector L122 与 L144–148 的绝对措辞；把可换线 cause code 收窄到可证明未发出的集合（排除 `ECONNRESET`/`UND_ERR_SOCKET`）；补「不会造成同一生成在网关侧出现两次完整请求」「连接重置后不换线」的负向场景，并说明与 DSH 重试的关系。工作量与风险都明显更大。

#### C3 — 凭据引用按「第 1 条/第 2 条」还是按稳定 id 绑定未定义；排序/删除会静默改变某条线路使用的凭据

- **位置**：[connector spec:7](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L7>)（「第一条线路」用 legacy 三个引用；「第 2 条及之后的线路」用 `MAGPIE_LINE_<ID>_*`）、[connector spec:17–21](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L17-L21>)（线路 1 ↔ `MAGPIE_API_KEY`、线路 2 ↔ `MAGPIE_LINE_2_API_KEY` 的场景）、[connector spec:180–184](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L180-L184>)（删除生效线路 1 后线路 2 仍「完整且可达」）、[line-selection spec:9](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L9>)（「线路数组顺序 + 1 = 线路序号」）、[line-selection spec:17–21](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L17-L21>)（上移线路 2 后配置/id 跟随移动）、[design:48](</openspec/changes/magpie-dual-lines/design.md#L48>)、[proposal:8](</openspec/changes/magpie-dual-lines/proposal.md#L8>)。
- **问题**：规格混用「第 1 条线路」与「按 id 派生」两种寻址方式，没有定义凭据引用绑定到**数组位置**还是**稳定 id**。两种读法都会让同一 change 内至少一个场景无法满足：
  - 若「第一条」= 数组位置 1（line-selection 已定义「序号 = 数组顺序+1」）：把线路 2 上移后，它变成「第一条线路」，按字面应改用 `MAGPIE_API_KEY`（旧/环境凭据）；原线路 1 降到第二条，按字面应改用 `MAGPIE_LINE_1_*`（并不存在）——等于排序时交换/丢失凭据，违反「线路 2 的配置跟随移动」与本 change 的按线路凭据隔离。删除原线路 1 后同理：唯一剩余线路（id=2）改用 `MAGPIE_API_KEY`，其 `MAGPIE_LINE_2_*` 被弃用，与 L180–184「线路 2 完整且可达」的场景冲突。
  - 若按稳定 id（id=1 ↔ legacy 引用、其余 ↔ 派生引用）：这是 design D2 的真实意图，也才能让「上移」「删除」安全；但 spec 的「第一条线路 / 第 2 条及之后」措辞与之不符，且「插件 SHALL NOT 读取未按线路声明的其它凭据引用」会把「id=2 的线路占据第一条位置」解释成读取 legacy 引用。
- **证据**：design D2 同时写了「线路 1 的凭据引用保持 …」「线路 id 由插件生成（递增数字），删除不复用」与「第 2 条及之后的线路使用派生引用」，但没有一字说明「线路 1」是位置还是 id；line-selection 又把序号定义为数组位置。当前实现的凭据引用是固定三元组（[runtime.ts:6–9](</packages/dsh-magpie-connector/src/host/runtime.ts#L6-L9>)、[test/support/credentials.ts:8–18](</packages/dsh-magpie-connector/test/support/credentials.ts#L8-L18>) 已可承接动态 ref，但必须先有确定的映射规则）。这是「按线路凭据隔离」的安全边界，不能留给实现猜测。
- **最小修法**：
  1. 在「插件身份与命名」明确：**凭据引用由稳定 line id 决定**——迁移创建的原始线路 id 为 `"1"`，使用三个 legacy 引用；其它 id 使用 `MAGPIE_LINE_<ID>_*`。把「第 2 条及之后的线路」改为「id 不为 `"1"` 的线路」。
  2. 明确「排序、删除、宿主重启 SHALL NOT 改变剩余线路的凭据引用」；删除 id=`"1"` 后 legacy 引用不再被任何线路读取（可写则随删除清理；环境提供则保留并在设置响应提示）。
  3. 补场景：上移/下移后各线路生成请求仍带各自原先的 key（用两把不同 key 断言 Authorization 归属，而不是只断言 id/地址）；删除 id=1 后剩余线路仍用其派生引用且保持完整可用；「按线路凭据互不覆盖」场景改为在排序后仍成立。

### 🟡 Moderate

#### M1 — 设置迁移只存在于 proposal/design，delta specs 没有任何迁移 requirement/scenario；且迁移可能写出违反本 change 自身不变量的线路

- **位置**：[design:48–51](</openspec/changes/magpie-dual-lines/design.md#L48-L51>)、[design:150](</openspec/changes/magpie-dual-lines/design.md#L150>)、[design:153](</openspec/changes/magpie-dual-lines/design.md#L153>)、[proposal:7](</openspec/changes/magpie-dual-lines/proposal.md#L7>)、[proposal:13](</openspec/changes/magpie-dual-lines/proposal.md#L13>)；三份 delta spec 中 `grep 迁移` 命中 0（唯一相关是 [line-selection spec:13](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L13>) 的「没有旧版设置文件」场景）。
- **问题**：迁移是本 change 对已发布 npm 插件的关键兼容承诺（单线路用户行为不变、旧 key/环境注入零迁移、baseUrl 镜像供降级），但没有任何 spec requirement/scenario，而 Anvil 的 test-plan 以 spec scenario 为单位做 1:1 映射——迁移会落不进验收。更严重的是迁移规则会产出非法状态：`任一 Access 凭据已配置 → cloudflare` 会把旧 `http` 地址 + 完整/部分 Access（旧实现下所有请求本来就会被 `MAGPIE_ACCESS_HTTPS_REQUIRED` / `MAGPIE_ACCESS_PAIR_REQUIRED` 拒绝）迁移为 `accessMode=cloudflare + 非 https / 不完整 pair` 的线路，直接违反 delta 自己新增的 [connector spec:81–83](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L81-L83>)（cloudflare 线路必须 https 且两项齐全）。若 Access 来自启动环境，该线路接入方式还是只读（L83），用户既不能切 direct 也无法补 env 凭据，只能改 URL——与「在家 LAN http」的目标冲突。design 没有定义这种非法迁移态如何展示、是否参与选择、请求如何失败。
- **证据**：当前校验确实会拒绝旧态（[transport.ts:4–9](</packages/dsh-magpie-connector/src/host/transport.ts#L4-L9>)、[runtime.ts:153](</packages/dsh-magpie-connector/src/host/runtime.ts#L153>)）；design D10 写了「迁移：临时目录写 v1 settings.json + credentials mock」（[design:133](</openspec/changes/magpie-dual-lines/design.md#L133>)）却无场景可挂。
- **最小修法**：新增 requirement「设置迁移」（或并入「网关连接与凭据」）+ 场景：无旧文件→默认一条线路；旧 v1 文件（baseUrl + key，无 lines）→迁移为 id=1 线路、保留 baseUrl 镜像、旧引用无需重输、只发生一次；旧 http + Access（env 提供）→按「不引入非法态」处理：或迁移为 direct 并保留 Access 引用为 legacy/ignored，或把线路标记未完整且不参与选择并给出可操作提示；部分 Access pair 同样定义。把「单线路用户行为不变」写成独立场景。

#### M2 — 「当前生效线路 / activeLineId」的定义、计算时机与刷新规则缺失；非生效线路外部凭据事件如何进行「是否换代」判定也无依据

- **位置**：[line-selection spec:43–49](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L43-L49>)、[line-selection spec:57–61](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L57-L61>)、[design:57](</openspec/changes/magpie-dual-lines/design.md#L57>)（GET 返回 `activeLineId`）、[design:109–110](</openspec/changes/magpie-dual-lines/design.md#L109-L110>)（打开时只展开 `activeLineId`）、[connector spec:110–111](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L110-L111>)（任一线路凭据事件是身份变化来源）与 [connector spec:120](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L120>)、[connector spec:31](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L31>)（操作定义仅目录同步/卡片/生成）。
- **问题**：spec 定义的操作不包括「设置读取」，因此设置 GET 不能靠本次操作重新选择，只能返回 host 内存中「最近一次操作选中的线路」（或自己探测，这与「探测只在操作开始」冲突）。但没有任何 requirement 定义该内存值的初值、陈旧规则与刷新时机；而 [SettingsPage.ts:57–68](</packages/dsh-magpie-connector/src/client/SettingsPage.ts#L57-L68>) 当前是先 `GET settings` 再 `GET cards`，首次打开/宿主重启后 `GET settings` 可能早于任何选择、恒显示线路 1——直接与「打开设置页时线路 2 已展开且带绿方块」的场景（line-selection L45–49）冲突。同理，`credentials/reference-updated` 到达时，插件必须判断该 ref 属于生效线路（按 L113–118 换代）还是非生效线路（按 L120 不换代），这需要同一个「当前生效线路」状态；否则会对非生效线路误换代（违反 L120）或对生效线路漏换代（违反 L113–118）。
- **证据**：当前 runtime 没有 active line 概念，`invalidateCredential()` 只用 `store.value.baseUrl` 并异步 sync（[runtime.ts:33–43](</packages/dsh-magpie-connector/src/host/runtime.ts#L33-L43>)）；`current` 代只存 baseUrl/fingerprint（[runtime.ts:11–14](</packages/dsh-magpie-connector/src/host/runtime.ts#L11-L14>)）；设置页读取顺序见上引。delta spec 全文没有 `activeLineId` 字样（只在 design 出现）。
- **最小修法**：定义「生效线路 = 最近一次操作的选择结果，保存在 host 内存；启动初值 = 序号 1 的完整线路（或明确写『首次操作前 active 为线路 1』）」；设置 GET 只返回该值、不触发探测；若要求打开设置页即显示真实 active，则改为设置页先读一次卡片（一次操作）再渲染/刷新，或把「设置读取」显式定义为操作并同步修改 connector L31 的操作定义。凭据事件按 ref→line id 解析：仅生效线路的引用变化换代；非生效只更新设置。补场景：宿主重启后首次打开（active 的确定性初值）、非生效线路外部改 key 不换代不清目录、生效线路外部改 key 换代并重新同步。

#### M3 — 探测实现不足以满足「单条超时 ≤600ms」；缺少 IPv6、取消、缓存键与凭据解析异常的边界定义

- **位置**：[line-selection spec:65](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L65>)（单条超时 ≤600ms）、[line-selection spec:69](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L69>)（探测不带凭据/不发 HTTP）、[design:78](</openspec/changes/magpie-dual-lines/design.md#L78>)（`net.connect({host, port, timeout: 600})`）、[design:81](</openspec/changes/magpie-dual-lines/design.md#L81>)（seam/时钟）、[design:143](</openspec/changes/magpie-dual-lines/design.md#L143>)（叠加时延风险）。
- **问题**：
  1. **超时语义**：Node v24.12.0 实测 `net.connect({timeout:600})` 只触发 `'timeout'` 事件，不会 destroy 或 reject（未处理时 lookup 继续、`connecting` 仍 true）。design 只写了这一调用，无法保证 600ms 内放弃；不可达/DNS 慢的线路可能拖到系统超时（数秒～数十秒），既违背 spec 的「单条 ≤600ms」，也让「多线路探测叠加时延」的风险结论失真。必须显式 `on('timeout') → destroy + reject`，并让截止时间覆盖 DNS lookup 阶段。
  2. **IPv6**：Node `URL.hostname` 对 IPv6 字面量返回带方括号的 `[::1]`，`net.connect({host:'[::1]'})` 直接 `ENOTFOUND`（实测）。若按 URL.hostname 直接探测，`http(s)://[::1]:…` 或 IPv6 局域网地址会被误判不可达；spec 的「对已配置线路的地址建立 TCP 连接」没有排除 IPv6，也没有场景。
  3. **缓存键/失效**：缓存按 lineId 还是按地址未定义；仅按 lineId 时，编辑线路地址/接入方式后旧「可达」结论仍会命中，导致把请求发往已改走的地址（随后真实失败）。design 只写了连接阶段失败失效缓存（[design:81](</openspec/changes/magpie-dual-lines/design.md#L81>)），没有写设置写入/删除线路时的失效。
  4. **取消与异常**：探测用的是 `node:net`，不在 `GatewayTransport` 的 private Agent 里（[transport.ts:11–13](</packages/dsh-magpie-connector/src/host/transport.ts#L11-L13>)），`dispose()` 不会自动中止 pending 探测；候选线路某条 `credentials.resolve` 抛错时是整体失败还是跳过该线路也未定义。
- **最小修法**：design D4 明确探测 Promise 由显式计时器 + `socket.destroy()` 收口（600ms 覆盖 lookup），host 对 IPv6 去方括号或使用 `net.isIPv6`，缓存键至少含 `(lineId, 规范化地址, accessMode, port)`，设置写入（地址/accessMode 变化）与删除线路时失效对应缓存，`dispose` 中止 pending 探测，凭据解析异常按「该线路视为不完整」处理（fail-closed 方向需写清）。spec 补 IPv6 线路可达场景、编辑地址后不沿用旧可达缓存的场景（可在注入的探测 seam 上断言连接次数）。

#### M4 — 线路删除 / 切回直连 / 清除 Access 的凭据写入失败与重启隔离，在新 schema 下未定义

- **位置**：[connector spec:35](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L35>)（删除线路清可写凭据、env 保留并提示）、[connector spec:73–77](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L73-L77>)、[connector spec:83](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L83>)（切回直连同一次写入清 Access）、[design:51](</openspec/changes/magpie-dual-lines/design.md#L51>)、[design:68](</openspec/changes/magpie-dual-lines/design.md#L68>)（保留 credentialUpdatePending、把 attempted 的线路字段名持久化后再动凭据）。
- **问题**：现有隔离机制只对固定三个 field 生效（[runtime.ts:29–31](</packages/dsh-magpie-connector/src/host/runtime.ts#L29-L31>) 用 `Object.hasOwn(credentialFields, field)` 校验；[runtime.ts:143](</packages/dsh-magpie-connector/src/host/runtime.ts#L143>)；[runtime.ts:159](</packages/dsh-magpie-connector/src/host/runtime.ts#L159>)），而新 schema 的 attempted 是 `(lineId, field)`，且删除线路后重启时该 lineId 可能已不存在——pending 的校验/重试语义（按「重新提交完整连接」还是 per-line）没有定义。更关键的是删除线路/切回直连的部分失败路径：若先移除 lines 项再 unset 失败，会留下「线路已删除但秘密残留」的 orphan；若先 unset 再移除，则失败可重试但中途状态未定义。spec 只描述成功结果，没有失败场景，而这是安全相关路径（仓规：安全路径应 fail closed）。
- **最小修法**：新增规则 + 场景：清理任一凭据失败时**不得**报告删除/切换成功，必须持久化可恢复的 pending（含线路 id/字段/目标 lines 快照），重启后按提示重试并在此期间拒绝新操作/同步；明确「只有全部可写凭据清理成功后才提交 lines 变更」或「先提交 lines 再清理失败则保留 orphan 并提示、且绝不把残留秘密用于任何请求」二选一；design D3 给出 pending schema v2 并说明旧 v1 pending 的迁移/失败处理。

#### M5 — 「继承上一代目录」窗口与「目录以生效线路为准」/AUTO「实时模型能力」校验冲突

- **位置**：[connector spec:120](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L120>)（继承目录、模型列表不得变空/闪断）、[proposal:10](</openspec/changes/magpie-dual-lines/proposal.md#L10>)（目录以当前生效线路为准）、[design:138](</openspec/changes/magpie-dual-lines/design.md#L138>)（不假设不同线路 key 看到相同目录）、[design:158](</openspec/changes/magpie-dual-lines/design.md#L158>)（两把 key 的 `/v1/models` 是否一致未实测）；相关能力：`openspec/specs/auto-model-routing/spec.md:22–23`（候选必须满足精确 provider/model 的**实时目录能力**）、[baseline spec:119–124](</openspec/specs/dsh-magpie-connector/spec.md#L119-L124>)、[baseline spec:571](</openspec/specs/dsh-magpie-connector/spec.md#L571>)。
- **问题**：自动切线路后、新线路目录同步完成前，`listModels` 暴露的是**旧线路**的目录（且不同 key 的可见集合可能不同）。在此窗口内：(a) 用户/AUTO 可能选到新线路不可见/不存在的模型，生成向新线路发出后失败；(b) AUTO 的「实时目录能力」校验基于陈旧目录，可能通过本应拒绝的路由；(c) 若新线路同步失败（L120 要求保留继承目录），窗口无界（直到下一次成功），不是 15s 有界。spec 没有定义继承目录的权威性/新鲜度语义，也没有「同步失败时仍显示继承目录」的失败场景。
- **最小修法**：明确「继承目录只用于选择器/设置页不闪断；生成与 AUTO 能力判定以新线路同步成功后的目录为准」（若要阻断，需要定义窗口内生成的行为，例如仍按旧目录模型 id 发往新线路并如实失败），或明确接受并写成场景/风险：「切到线路 2 后同步失败，目录仍为继承的 13 个模型且 lastSyncError 非空；此期间基于该目录的生成会真实发往线路 2 并按其结果成功/失败」。同时在 Risks 中显式声明 AUTO 的实时性在切换窗口内暂时退化（或与 auto-model-routing 的 delta 协同）。

#### M6 — 发布影响清单漏掉随 npm 发布的文档/截图与仓库级描述

- **位置**：[proposal:30](</openspec/changes/magpie-dual-lines/proposal.md#L30>)（发布只列 0.2.0 + dsh.yaml + README 双语 + CHANGELOG）、[design:149](</openspec/changes/magpie-dual-lines/design.md#L149>)；现状发布资产：`package.json` 的 `files` 含 `docs`、`screenshots.json`（[package.json:36–47](</packages/dsh-magpie-connector/package.json#L36-L47>)），[README.zh.md:6–7](</packages/dsh-magpie-connector/README.zh.md#L6-L7>) 内嵌 `docs/settings.gif`/`model-picker.gif`、[README.zh.md:75](</packages/dsh-magpie-connector/README.zh.md#L75>) 链接架构图；[docs/architecture.zh.json:64](</packages/dsh-magpie-connector/docs/architecture.zh.json#L64>)（credentials = `MAGPIE_API_KEY · Access 令牌`）、[:86](</packages/dsh-magpie-connector/docs/architecture.zh.json#L86>)（settings store = `地址 · 可见性 · 默认 effort`）、[:107](</packages/dsh-magpie-connector/docs/architecture.zh.json#L107>)、[:262](</packages/dsh-magpie-connector/docs/architecture.zh.json#L262>)；[docs/internal-api.md:24](</packages/dsh-magpie-connector/docs/internal-api.md#L24>)、[:27](</packages/dsh-magpie-connector/docs/internal-api.md#L27>)、[:31](</packages/dsh-magpie-connector/docs/internal-api.md#L31>)、[:62](</packages/dsh-magpie-connector/docs/internal-api.md#L62>)、[docs/SCREENSHOTS.md:6](</packages/dsh-magpie-connector/docs/SCREENSHOTS.md#L6>)、[dsh.yaml:388–394](</dsh.yaml#L388-L394>)、根 [README.md:208](</README.md#L208>)、[README.zh.md:208](</README.zh.md#L208>)。
- **问题**：设置页从「平铺连接表单」改成线路卡片后，`settings.gif` 展示的旧界面、`SCREENSHOTS.md` 的验收口径、架构图里的「单 settings store / 全局 Access / 直连白名单」、`internal-api.md` 的旧 host API 全部过时，并且这些都在 npm 包里作为产品文档发布（`files: docs`）——用户升级 0.2.0 会看到与真实 UI/API 不符的截图和 API 文档。proposal 的发布清单只覆盖 README/CHANGELOG/dsh.yaml，未覆盖这些资产；根 README 的插件能力描述也需补「多线路」。
- **最小修法**：Impact/Migration 增加：重生成 `docs/architecture.{zh,en}.{json,svg}`、重录 `docs/settings.gif` + 更新 `screenshots.json`/`SCREENSHOTS.md`、更新或标注 `docs/internal-api.md`（或从发布 `files` 移除）、更新根 `README*.md` 的插件描述；`dsh.yaml` note 的信任面从「读取 MAGPIE_API_KEY、单 route」改为「按线路读取 key/Access、多线路探测不带凭据」；验收加一条「`npm pack` 产物中不存在旧 UI 截图/旧 API 描述」。

#### M7 — 回滚/降级计划不完整：env 拥有的 Access 无法清空、删除原线路 1 后镜像与 legacy 引用错配、降级期间的编辑在再升级时被静默丢弃

- **位置**：[design:50](</openspec/changes/magpie-dual-lines/design.md#L50>)（baseUrl 镜像、`lines[0]` 唯一真相源）、[design:153](</openspec/changes/magpie-dual-lines/design.md#L153>)（回滚步骤）、[design:145](</openspec/changes/magpie-dual-lines/design.md#L145>)、[connector spec:35](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L35>)、[connector spec:83](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L83>)。
- **问题**：
  1. design L153 说回滚时若线路 1 为 http 而 Access 引用仍存在，「需要清空 Access」——但若 Access 来自启动环境，设置操作不能清空（本 change 自己的只读规则），实际回滚需要移除 env 注入并重启 Host，设计未写；
  2. 删除原线路 1 后 `baseUrl` 镜像指向新的首条线路，旧版本会用 legacy `MAGPIE_API_KEY`/`MAGPIE_ACCESS_*` 去连新首条线路的地址——地址与凭据错配（至少 401；若 legacy Access 仍在，会把旧 Access 令牌发到另一个 ingress）；
  3. 降级期间旧版本只能写 `baseUrl`/legacy key（`lines` 保留不更新），再升级时因为存在 `lines` 不会迁移，`lines[0]` 覆盖降级期间的编辑，且无任何提示——静默丢失配置。
- **最小修法**：回滚节补：env Access 需从启动环境移除并重启；删除原线路 1 后回滚需手工把镜像地址与 legacy key/Access 对齐（或先重新调整线路再回滚）；定义再升级冲突策略（检测 `baseUrl` 镜像 ≠ `lines[0].baseUrl` 时警告/要求选择，或明确「降级编辑会被丢弃」并写入 README/CHANGELOG）；把 design L50 的「只读镜像」改为「兼容镜像：新版本仅迁移时读取，旧版本会写入」以免误导。

#### M8 — 「线路 id 删除不复用」没有持久化机制；复用会把已删除线路的 env 凭据静默接到新线路上

- **位置**：[design:48](</openspec/changes/magpie-dual-lines/design.md#L48>)（「线路 id 由插件生成（递增数字），删除不复用」）、[design:37–46](</openspec/changes/magpie-dual-lines/design.md#L37-L46>)（schema 示例里没有 id 计数器）、[connector spec:7](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L7>)（派生引用）、[connector spec:35](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L35>)（env 凭据删除时保留）、[line-selection spec:9](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L9>)（id 稳定）。
- **问题**：若 id 取「现有最大值 + 1」（schema 没有任何持久计数器），删除当前最大 id 的线路后再新增会复用该 id。若被删线路的派生凭据来自启动环境（按 L35 保留且不可写），新线路会静默继承这些 env 凭据，并把它们发往新线路的地址——违反「按线路凭据隔离」的安全边界。spec 也没有「id 不得复用」的不变量，只有「排序/删除不改变剩余线路 id」。
- **最小修法**：settings schema 增加持久 `nextLineId`（或等价单调计数器），迁移时初始化为 `max(现有 id)+1`；「线路列表与优先级」增加「新建线路 id SHALL 从持久计数器分配、单调递增且永不复用；删除/排序/重启不改变 id」；补场景：删除最高 id 线路（其 env key 保留）→ 新增线路获得新 id，设置响应显示新线路未配置、不继承旧 env 引用。

#### M9 — 设置写入契约不完整/不自洽（id 分配、不完整线路表示、空地址重复校验、accessMode 持久化与旧 scenario、retained 提示字段）

- **位置**：[design:57–69](</openspec/changes/magpie-dual-lines/design.md#L57-L69>)（GET/POST shapes）、[connector spec:27](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L27>)（地址不得相同）、[connector spec:49–53](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L49-L53>)（env 保留并提示）、[connector spec:81](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L81>)（accessMode 持久化）、[connector spec:87–91](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L87-L91>)（保存请求体只含该线路两项 Access）、[line-selection spec:9](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L9>)（未完整线路允许保存）、[line-selection spec:31–33](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L31-L33>)（线路 2 只有地址、没有 key）。
- **问题**：
  1. 整表提交时**新线路 id 由谁分配**未定义（客户端给临时 id vs host 生成），而 id 决定凭据引用；写错会让 secret 落到错误引用。
  2. 「未完整配置的线路允许保存」没有定义空地址/空 key 的 JSON 表示；而 L27「两条线路地址 SHALL NOT 相同」会把两个空地址判成重复，与「允许保存未完整线路」冲突。
  3. L87–91 场景的 THEN 仍是旧 API 语义（「保存请求体只含该线路的 `accessClientId` 与 `accessClientSecret`」），与 L81「接入方式 SHALL 与线路一起保存」及 design D3 的 lines 数组不一致——按字面无法同时满足。
  4. L49–53「设置响应中提示该凭据保留」没有响应字段约定（design D3 的 lines 元素没有 `retained`），不可机械断言。
  5. design D6 的「`ConnectionIdentity` 增加 `accessMode`（**或由调用方决定**是否带 Access）」仍未定选；若不加 lineId，D8 的 `lineFailed(lineId)` 在 transport 层无法实现（[transport.ts:3–4](</packages/dsh-magpie-connector/src/host/transport.ts#L3-L4>)）。
- **最小修法**：明确 POST lines 元素契约——新线路省略 id（host 分配并在响应返回），既有线路必须带 id；空地址用 `baseUrl: ""` 表示且重复校验忽略空地址；`accessMode` 为必填枚举；响应 lines 的每个凭据状态加 `{configured,writable,retained?}`（或顶层 `retainedCredentials`）并写进 spec；L87–91 的 THEN 改为「请求体 lines 中该线路 `accessMode=cloudflare`，且该线路仅 Access 两项发生变化，key/地址未变」；D6 选定 accessMode（和 lineId）进入 `ConnectionIdentity`。

#### M10 — 自动选择只有「连接阶段失败」兜底：TCP 通而服务坏/鉴权错时无运行时逃生口，且 Risks 表述与实际边界不一致

- **位置**：[line-selection spec:65–69](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L65-L69>)、[line-selection spec:41–43](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L41-L43>)、[design:124–126](</openspec/changes/magpie-dual-lines/design.md#L124-L126>)（手动选择 Non-goal）、[design:139](</openspec/changes/magpie-dual-lines/design.md#L139>)（TCP 探测误判 → 连接阶段失败立即失效缓存并按规则换线一次）。
- **问题**：探测只测 TCP；端口通但网关服务坏、home key 失效、Access 拒绝等都会让选中的线路在真实请求中失败，而「其它失败（HTTP 错误/流中断）SHALL NOT 由插件重放」意味着不会落到线路 2；同时本 change 明确不提供手动选择（line-selection L43、design D9），生效指示也刻意静默。常见场景（家里 LAN 地址可达但 key/上游故障）会让用户每轮都失败，只能手工编辑/删除线路才能脱困。design L139 写「连接阶段失败立即失效缓存并按规则换线一次」，容易被读成所有失败都可换线，与 spec L69 的实际边界不一致。
- **最小修法**：不要求新增手动档位（尊重已确认 Non-goal），但至少在 spec/design 明确逃生口（设置页可见 active 线路 → 用户可编辑/停用/删除该线路）并补场景：「线路 1 TCP 可达但 `/v1/models` 返回 401/503：请求如实失败，插件不自动换线，设置响应 `lastSyncError`/卡片状态与当前 active 线路可对应」；把 Risks L139 改为「只有可证明请求未发出的连接阶段失败才失效缓存；HTTP/流失败如实上抛、不换线」（若按 C2 删除生成换线，该句也一并改）。

### 📌 Suggestions

#### S1 — design 对现状的引用有几处过时或不精确（附核验行号）

- [design:3](</openspec/changes/magpie-dual-lines/design.md#L3>)「settings.ts 只保存 baseUrl、可见性与默认 effort」：实际还持久化 `credentialUpdatePending`（[settings.ts:3](</packages/dsh-magpie-connector/src/host/settings.ts#L3>)）。
- 同段「runtime.ts 把 baseUrl + key 当作连接身份」：实际指纹早已包含 Access 三元组（[runtime.ts:55–59](</packages/dsh-magpie-connector/src/host/runtime.ts#L55-L59>)）；本 change 是重定义身份，不是首次纳入 Access。
- [design:103](</openspec/changes/magpie-dual-lines/design.md#L103>)「retainIdentity 覆盖已 prepared 的操作凭据」：prepared 凭据由 `trackPrepared` + `redact` 的 prepared WeakRef 集合覆盖（[runtime.ts:17–22](</packages/dsh-magpie-connector/src/host/runtime.ts#L17-L22>)、[runtime.ts:81–90](</packages/dsh-magpie-connector/src/host/runtime.ts#L81-L90>)），`retainIdentity` 负责 active 引用；措辞应改为「prepared 集合 + active 引用共同覆盖」。
- [design:120](</openspec/changes/magpie-dual-lines/design.md#L120>)「由 transport 捕获后向 runtime 上报 `lineFailed(lineId)`」：`ConnectionIdentity` 没有 lineId，需写明加字段或由 adapter 上报。
- [design:140](</openspec/changes/magpie-dual-lines/design.md#L140>)「既有 8 个身份场景」：当前基线「连接身份与代际隔离」只有 **7** 个场景（[baseline spec:84–117](</openspec/specs/dsh-magpie-connector/spec.md#L84-L117>)），archive 的 test-plan 也列 7 条（[archive test-plan:10–16](</openspec/changes/archive/2026-10-27-add-dsh-magpie-plugin/test-plan.md#L10-L16>)）。改为 7 或说明第 8 条指哪个。
- [design:48](</openspec/changes/magpie-dual-lines/design.md#L48>)「id 为大写后拼成 `MAGPIE_LINE_<ID>_*`」与 [connector spec:7](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L7>)「`<ID>` 仅含大写字母与数字」vs design「递增数字」：范围措辞统一（若 id 永远数字，就写数字，避免无意义的大写规则）。
- [design:78](</openspec/changes/magpie-dual-lines/design.md#L78>) 只写 `net.connect({…timeout})`：见 M3 实测，需替换为显式截止+destroy。

#### S2 — 「经 Cloudflare 建连的 10 秒级超时」在引用材料中找不到出处

[proposal:3](</openspec/changes/magpie-dual-lines/proposal.md#L3>) 与 [design:5](</openspec/changes/magpie-dual-lines/design.md#L5>) 声称该 10 秒级超时；引用文档 `packages/dsh-magpie-connector/docs/cloudflare-524-long-requests.md` 经 grep 无「10 秒 / 10s」，只记录 125s Proxy Read Timeout、30s Proxy Write Timeout、900s Idle Timeout 与 524；[README.zh.md:49](</packages/dsh-magpie-connector/README.zh.md#L49>) 也只写「源站 100 秒内没有响应会返回 524」。若该 10s 指 undici 默认 `connectTimeout`，它不是 Cloudflare 特有、也与「经 CF 建连」的归因不符，且本机源码未证实插件使用该默认值。请补证据或删除。

#### S3 — 场景 THEN 的可机械断言性不足（合并项）

- 「4×4 绿色方块」（[line-selection spec:43](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L43>)、[:47–49](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L47-L49>)）：没有规定颜色/尺寸 token 与可查询标识；design D7 有 `aria-label="当前线路"`（[design:110](</openspec/changes/magpie-dual-lines/design.md#L110>)），建议写进 spec（例如固定 4px×4px、固定色值、`aria-label`），否则「绿色」在测试里只能靠实现自证。
- 「页面没有 toast 或横幅」（L49、L61）是弱否定断言；建议规定 DOM 契约（无新增 `role=alert/status` 通知容器/无 `aria-live` 追加）。
- 「线路 1 只可能收到未完成的 TCP 连接尝试」（[line-selection spec:87](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L87>)）：未监听端口无法观测连接尝试；建议改为「线路 1 的 HTTP mock 收到 0 个请求」+ 探测 seam 记录。
- 「第二次删除被拒绝**或**删除入口禁用」（[line-selection spec:27](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L27>)）：二者择一并写死，便于 test-plan 1:1 映射。
- 「以真实连接错误（例如 `TRANSPORT` / `TIMEOUT`）结束」（[line-selection spec:93](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L93>)）：建议固定为 `TRANSPORT`（ECONNREFUSED 走 `classifyFailure` 的 TRANSPORT 分支，[adapter.ts:88–92](</packages/dsh-magpie-connector/src/host/adapter.ts#L88-L92>)）。
- 设置页折叠/展开没有 DOM 契约（`<details open>` 还是自定义组件、断言属性）；线路卡片选择器/`data-*` 测试锚点未定义，UI 场景难以稳定断言。

#### S4 — 探测总时延与线路数量没有上限

[line-selection spec:65](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L65>) 只限单条 ≤600ms；顺序探测 N 条线路最坏 N×600ms 叠加在每次缓存过期后的操作开始（包括设置页首次读卡片），N 无上限。建议 spec/design 加总预算（首次可达即停已有，但最坏情况仍需上限）或限制线路数（如 ≤5，写进设置校验），避免设置页打开被探测拖慢。

#### S5 — cloudflare 线路在外部凭据被清除/部分失败后的状态未定义

[connector spec:81–83](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L81-L83>) 要求 cloudflare 必须 https + 成对凭据，但 accessMode 已持久化；若 env/凭据文件被外部移除，线路会处于「mode=cloudflare 但无凭据」。它是否算完整、是否参与自动选择、请求失败还是降级 direct 都没写。建议明确：凭据缺失的 cloudflare 线路视为未完整（不参与自动选择）并在设置页标注；或降级 direct 并提示。

#### S6 — design 声称「规范与 UI 均声明同一网关」，但规范没有该声明或校验

[design:22–23](</openspec/changes/magpie-dual-lines/design.md#L22-L23>) 的 Non-goal 写「支持两条线路指向不同网关或不同 Magpie 实例（规范与 UI 均声明同一网关）」；实际 line-selection/connector delta 没有 same-gateway requirement，校验只禁止地址相同（[connector spec:27](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L27>)），UI 也没有「同一网关」声明（SettingsPage 文案只有「通过自托管的 Magpie 网关使用模型」）。要么加一句 UI 提示 + 规范声明，要么删掉括注、把「同一网关」降级为未强制的使用假设（design L138 已经承认不同 key 目录可能不一致）。

#### S7 — 「唯一的 active 指示」与「默认只展开生效线路」自相矛盾

[line-selection spec:43](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L43>) 同时要求「默认只展开当前生效线路」与「4×4 方块作为**唯一** active 指示」；默认展开本身就是 active 指示。建议改为「除默认展开外，唯一的图形化 active 指示是序号后的方块」，避免测试与可访问性 review 的歧义。

#### S8 — 变更体量与回归面建议拆分或分层排序

本 change 同时改设置 schema + 凭据引用 + Access 归属 + 身份/换代语义 + 自动选择 + 设置页 UI + 迁移回滚（[proposal:7–13](</openspec/changes/magpie-dual-lines/proposal.md#L7-L13>)、[design:35–134](</openspec/changes/magpie-dual-lines/design.md#L35-L134>)），design 自己也承认「身份与换代重构回归面大」（[design:140](</openspec/changes/magpie-dual-lines/design.md#L140>)）。建议 tasks 按「schema/凭据/迁移 → 按线路 Access → 身份/继承 → 自动选择 → UI」分层提交与验证，或把自动选择拆成后续 change；至少每层独立保留回归门（现有 7 个身份场景 + access-auth 现有场景逐条绿）。

#### S9 — 缓存/故障边界缺可断言场景

line-selection 只有负缓存场景（[:95–99](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L95-L99>)）；缺：正缓存期内不重复探测、连接阶段失败后缓存失效（下一次操作重新探测）、编辑线路地址后不沿用旧缓存、dispose 中止 pending 探测。建议各补一条（多数可在注入的探测 seam 上断言连接次数）。

### 回归影响核验（既有身份/换代场景）

当前基线「连接身份与代际隔离」有 7 个场景（[baseline spec:84–117](</openspec/specs/dsh-magpie-connector/spec.md#L84-L117>)；design 写「8 个」见 S1）；本 change 的 delta 保留了全部 7 个并新增 3 个。逐条评估：

- 换地址后不显示旧目录、换 key 后不显示旧卡片、旧代晚到的响应被丢弃、进行中的生成不被换代中止：只要单线路场景下 **lineId 不变 → 换代且不继承目录**（design D5 第 91 条）成立，行为与旧实现一致；C1 修好身份定义后成立。
- 已准备的调用按捕获值跑完：design L93 把 adapter/cards 改用 `op.baseUrl`/`op.key` 后成立；但 C2 的生成换线若保留会破坏该场景的「只使用捕获值」断言。
- 外部改 key 触发换代、未收到事件时新操作发现 key 变化：依赖 M2 的「ref→line id 映射 + 当前生效线路」定义；不解决则可能对非生效线路误换代（违反 L120）或漏换代。
- Access rotation during discovery / Prepared operation（magpie-access-auth 基线）：同线路 Access 变化需继续换代（指纹含 Access），design D5 的「lineId 不变但 Access 变化→不继承」覆盖；需在实现中保持 `validateIdentity` 的请求期校验（[transport.ts:4–9](</packages/dsh-magpie-connector/src/host/transport.ts#L4-L9>)）。
- 结论：C1/M2/C2 修好前，回归面比 design 宣称的大；「既有场景全部保留为回归」目前只在纸面上成立，未到可机械验证状态。

### 安全边界核验（通过项与需补项）

- **Access 不得发明文 http**：通过。cloudflare 线路必须 https（[connector spec:81–83](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L81-L83>)）、直连/http 永不带 Access（[:85](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L85>)、[:197](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L197>)、[:227–231](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L227-L231>)）、access-auth delta 同步（[access-auth spec:5](</openspec/changes/magpie-dual-lines/specs/magpie-access-auth/spec.md#L5>)）；迁移非法态见 M1。
- **探测不带凭据、不发 HTTP**：通过（[line-selection spec:69](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L69>)、[connector spec:199](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L199>)）；超时/IPv6 实现风险见 M3。
- **脱敏覆盖所有线路**：通过（[connector spec:33](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L33>)、[:43–47](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L43-L47>)）；删除线路后残留的 env 秘密不再属于「已配置线路」→ 不在脱敏集合，也不会被发送，可接受（design 未写，建议在 D6 补一句）。
- **按线路凭据隔离**：**未通过**（C3、M8）。这是本 change 最重要的安全边界，排序/删除/id 复用都可能让一条线路读到另一条线路的凭据。
- **删除线路只清可写凭据**：成功路径通过（[connector spec:35](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L35>)、[:73–77](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L73-L77>)）；失败/重启路径缺失，见 M4。
- **环境注入零迁移**：目标正确，但迁移非法态与回滚限制见 M1/M7。
- **传输白名单/拒绝重定向/私有 dispatcher**：本 change 只增「探测例外」，不放松既有边界（[connector spec:186–201](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L186-L201>) vs baseline [321–346](</openspec/specs/dsh-magpie-connector/spec.md#L321-L346>)），通过；但探测直接用 `node:net`，需按 M3 保证 dispose 可取消（不新增越权网络面）。

### 已检查但未发现额外影响的路径

- **AUTO / AUTO 显示**：`dsh-magpie-connector` 作为精确 transport 的注册/恢复逻辑不变（`openspec/specs/auto-model-routing/spec.md:395–407`），route id 不变；但「实时目录能力」在切换窗口的陈旧风险见 M5，未发现其它需改的 AUTO 规范。
- **home-network-model-guard 豁免**：按 route ID 精确匹配（`openspec/specs/home-network-model-guard/spec.md:255–261`、`openspec/specs/home-network-model-guard/spec.md:271`、[patches/home-network-model-guard-config.yml:6](</patches/home-network-model-guard-config.yml#L6>)），route id 不变 → 无影响；`dsh.yaml:409–410` 的豁免说明不需要改语义。
- **侧边栏品牌识别**：按 provider route 判定（`openspec/specs/sidebar-session-provider-icon/spec.md:72`、`:107–115`），route id 不变 → 无影响。
- **`magpie-display-name-shim`**：只桥接 `dsh-magpie-connect` route（[dsh.yaml:396–403](</dsh.yaml#L396-L403>)），与本 change 无关。
- **发布触发**：`.github/workflows/mirror-release.yml:19`/`:41–42` 以包目录为触发面，版本 bump 自然触发；`package.json` 的 `prepare`/`prepack`（[package.json:61–66](</packages/dsh-magpie-connector/package.json#L61-L66>)、[package.json:3](</packages/dsh-magpie-connector/package.json#L3>) 版本 0.1.2）与 `dsh.yaml:388–394` 的版本/note 已在 proposal L30 覆盖（资产遗漏见 M6）。
- **`docs/cloudflare-524-long-requests.md` 与 BACKLOG D014**：D014 记录 127.2/128.1/129.7s 与 125s 边缘限制；proposal 的「100–125 秒级」与 README 的「100 秒」混合了官方 100s/实测 125s 两种口径，建议统一为「125s 边缘上限（观察 127–130s）」以免引用争议（不单独列 finding）。
- **当前 spec 的禁用不删除数据、用量卡片、模型可见性、默认 effort、输出预算、侧边栏图标等 requirement**：本 change 未修改其行为，也未发现被多线路间接破坏的路径（用量卡片随线路换代清空/重读是设计已接受的行为；`cards.ts` 的 gen 作用域天然隔离，[cards.ts:28](</packages/dsh-magpie-connector/src/host/cards.ts#L28>)、[:55](</packages/dsh-magpie-connector/src/host/cards.ts#L55>)）。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected

扫描了 `proposal.md`、`design.md`、三份 delta spec（关键词 `reviewer|评审|ignore (all|previous|the)|verdict|你必须|不得修改|do not review`），未发现试图指挥评审者跳过检查、执行命令、改变 verdict 或写入其它文件的嵌入指令。设计中「adversarial reviewer will attack unjustified decisions」是模板要求，不构成注入；`proposal`/`design` 里关于 ponytail/用户决定的引用只作为待核验主张，不作为指令。

## Verdict

本轮 **3 Critical / 10 Moderate / 9 Suggestions**。

三个 Critical 都落在本 change 的核心语义上：连接身份到底由什么定义（C1）、生成一旦准备后能否换线且换线是否安全（C2）、凭据引用绑定位置还是稳定 id（C3）。它们不是局部文案问题，需要作者重新做语义决定并同步改写 spec/design/场景；此外 Moderate 里还有迁移、active 线路、探测可满足性、凭据失败路径、继承目录权威性、发布资产与回滚等需要补齐。按 Anvil 的严重度—verdict 一致性规则，存在未解决 Critical 不得 APPROVE；且 C1/C2 的修复不是「小、无歧义、完全可列举」的编辑，因此本轮不能走 APPROVE_WITH_CHANGES，只能是 REVISE。

<!-- Human-readable restatement: REVISE — fix the three Critical semantics, then re-run the full review in a fresh context. -->

VERDICT: REVISE

## Required Changes (if APPROVE WITH CHANGES)

n/a（VERDICT: REVISE，无 Required Changes 列表）。修复方向见每条 Finding 的「最小修法」；退出条件见下一节。

<!-- CANONICAL FIELD — machine-readable completion signal -->
<!-- Values: yes (all applied & re-checked) | no (outstanding) | n/a (verdict is APPROVE or REVISE, no required changes). -->

CHANGES_APPLIED: n/a

## REVISE 的退出条件（供下一轮作者修订与再评审）

1. **C1**：把连接身份重新定义为「生效线路指纹 + 设置版本」，明确目录继承是显式例外；同步修正 connector spec L107–120 与 design D5，补非生效线路事件/生效线路配置变化两个场景。
2. **C2**：二选一并写全面——推荐删除生成路径的透明换线（保留探测 + DSH `llm-retry`），同步 proposal L9、design D8、line-selection L69/L101–105；若保留，必须收窄可换线错误集、改写捕获语义并补「不会重复提交同一生成」的负向验收。
3. **C3**：凭据引用按稳定 line id 绑定（id=1 ↔ legacy 三个引用，其余 ↔ `MAGPIE_LINE_<ID>_*`）；排序/删除不改变剩余线路引用；补排序/删除后的 key 归属场景。
4. **Moderate**：M1–M10 至少逐条 fixed 或在 Rebuttals 中给出可接受理由（Critical/Moderate 的 rebuttal 需 reviewer 复核接受，Suggestions 可由作者自行决定）。
5. 修订后重跑 `openspec validate magpie-dual-lines --strict`，重算四份制品散列并在新一轮 review 的 Review Metadata 中记录；本轮 verdict 对旧哈希失效，下一轮为 round 2、需 fresh context 完整重审。若出现连续第 2 次 REVISE，按 Anvil 规则停止循环、升级给人类。

## Rebuttals

<!-- Author responds to findings: fixed (cite change) or rebutted (reasoning). -->
<!-- Rebuttals are NOT self-certifying: a rebuttal of a Critical or Moderate -->
<!-- finding counts only once marked "accepted by reviewer" with a one-line reason. -->
<!-- Suggestions may be declined by the author alone. -->

（留空，由作者在修订后填写）

## Rebuttals（作者于 round 2 前填写）

处置原则：C1–C3 与 M1–M10 全部 fix；S1–S7、S9 fix；S8 采纳为 tasks 分层要求。以下逐条对应修订后制品。

- **C1 fixed.** 重写 connector「连接身份与代际隔离」：身份 = 生效线路指纹（lineId/地址/接入方式/key+Access 指纹）；线路集合与顺序属于选择配置，单独变化不是身份变化；线路切换作为「不得回退」的唯一显式例外（继承目录但不得标记为同步成功、卡片清空）；新增「非生效线路外部凭据变化不换代」「切换后同步失败保留继承目录」两个场景。design D5 同步重写。
- **C2 fixed.** 删除生成路径透明换线：line-selection 删除 MAY 换线与换线场景，新增「失败处理与不重放」requirement（连接阶段失败只失效缓存、本次失败、下一次重新选择；其它失败不重放；TCP 可达但网关报错不换线）；design D8 与 proposal 同步；保留「插件从不自行重放已发出的生成请求」承诺。
- **C3 fixed.** 凭据引用改由稳定 id 决定：id=`"1"` 用 legacy 三引用，其它 id 用 `MAGPIE_LINE_<ID>_*`；排序/删除/重启不重绑；删除 id=1 后 legacy 引用不再被读取；新增「凭据引用由稳定 id 绑定」「删除线路后 id 不复用」两个场景；design D2 同步。
- **M1 fixed.** 新增「设置迁移」与「迁移推断与降级冲突」两个 requirement（3 个场景）：迁移只发生一次、初始化 nextLineId=2、写兼容镜像；旧 http/不完整 Access 迁移为 direct 且保留不使用的旧引用，不产出非法线路；降级期间 baseUrl 镜像冲突以 lines 为准并提示。
- **M2 fixed.** 定义生效线路 = 最近一次操作（含设置读取）的选择结果，启动初值为序号 1 的完整线路；设置读取本身执行一次选择但不发 HTTP（design D4）；新增「设置读取返回并更新生效线路」场景。凭据事件按 ref→line id 映射，只有映射到生效线路才换代（design D5 + 非生效线路事件场景）。操作定义已含「一次设置读取」。
- **M3 fixed.** design D4：探测显式计时器 + `socket.destroy()` + 截止覆盖 DNS；IPv6 去方括号/`net.isIP`；缓存键含 lineId/地址/accessMode/端口、地址编辑/删除/连接失败/dispose 失效并 abort；新增「IPv6 字面量地址可被探测」「dispose 中止探测」「正缓存与地址编辑后失效」场景。
- **M4 fixed.** 新增「设置写入的凭据隔离与失败恢复」requirement（pending v2 为 `(lineId, field)`，失败不提交 lines/接入方式、重启拒绝新操作、可含已删除线路 id）+ 两个失败场景；design D3。
- **M5 fixed.** spec 明确继承目录只用于展示与模型 id 解析、不得标记同步成功、`lastSyncAt` 保持；新增「切换后同步失败保留继承目录」场景；design Risks 与 D5 明确窗口内 AUTO 实时性退化且本 change 不新增 auto-model-routing delta。
- **M6 fixed.** design D10 列出发布资产与 `npm pack` 检查；proposal Impact 同步补充。
- **M7 fixed.** design Migration Plan 补：env Access 回滚需移除启动环境并重启；删除 id=1 后回滚需手工对齐镜像与 legacy 凭据；降级编辑冲突提示（并入 M1 场景）。
- **M8 fixed.** settings v2 持久化 `nextLineId`，迁移初始化为 2，单调递增永不复用；新增「删除线路后 id 不复用」场景；design D2。
- **M9 fixed.** design D3 明确结构化 POST 契约：新线路省略 id、空地址用 `baseUrl: ""` 且不参与重复校验、accessMode 必填枚举、响应凭据状态含 `configured/writable/retained`；connector「Access 线路必须是 https」等场景 THEN 改为可机械断言的新契约；transport identity 增 `accessMode`（取消 `lineFailed` 方案）。
- **M10 fixed.** 新增「失败处理与不重放」requirement 与「TCP 可达但网关报错时不自动换线」逃生口场景；Risks 边界表述同步修正。
- **S1 fixed.** design Context/D5 已修正：`credentialUpdatePending`、既有指纹已含 Access、prepared 集合 + active 引用共同覆盖、7 个身份场景、id 为数字字符串、探测显式计时器。
- **S2 fixed.** 删除无出处的「10 秒级超时」表述（proposal/design 改为「额外的建连时延」）。
- **S3 fixed.** spec 增加机械断言契约：`data-line-id`/`data-expanded`/`data-active-line`、4×4 px、`aria-label`、禁止新增 `role=alert/status`/`aria-live`/`alert/confirm`；删除最后一条固定为 host 400 + 入口禁用；序号 1 不可达改为「HTTP mock 0 请求 + 探测记录」；错误固定为 `TRANSPORT`。
- **S4 fixed.** 线路数上限 5（含 400 场景）；design Risks 给出最坏探测时延上限。
- **S5 fixed.** cloudflare 线路凭据缺失 → 未完整、不参与选择、不自动降级 direct；新增场景；design D6。
- **S6 fixed.** design Non-goals 改为「同一网关是配置契约（插件无法机械校验）」，不再声称规范校验；UI 加提示。
- **S7 fixed.** 改为「除默认展开外，唯一的图形化 active 指示是序号后的方块」。
- **S8 accepted.** design D11 与 Migration Plan 规定 tasks 分层（schema/凭据/迁移 → Access → 身份/继承 → 探测/选择 → UI/发布资产），每层独立回归门。
- **S9 fixed.** 新增正缓存/地址编辑失效、连接阶段失败失效缓存、dispose 中止探测场景。
