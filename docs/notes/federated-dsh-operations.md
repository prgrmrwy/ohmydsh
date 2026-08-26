# 联邦 DSH 控制面运维说明

对应 OpenSpec change `federated-dsh-control-plane`，本地 package
`packages/dsh-federation`。本文只描述运维与故障处理；架构理由见该 change 的
`design.md`。

> 当前状态：`dsh.yaml` 中 `dsh-federation` 为 `enabled: false`。M3 真实三节点验收
> （tasks 10.1–10.3）完成前不要启用。Adapter 已对**真实 rc.2 `dsh web`**（隔离
> `DSH_HOME`）完成一致性验证，见
> `openspec/changes/federated-dsh-control-plane/checking/compatibility/rc2-live-conformance-report.md`。

## 1. 模型与边界

层级是 **Node → Workspace → Session**。中央 DSH 只做两件事：

1. 用系统 OpenSSH 建立到远端的 **回环端口转发**；
2. 把远端普通 `dsh web` 的 workspace/session 投影进一个联合视图。

远端始终是**独立的 DSH 安装**，保留自己的模型、订阅、凭据、目录、Git 状态、
workspace 与 session。中央**不做**这些事：

- 不安装、不启动、不停止远端 DSH；
- 不同步文件、不映射路径、不自动下载；
- 不代理远端设置/订阅/凭据，也不读取中央凭据以外的任何密钥；
- 不把远端路径交给中央 `host.openPath` 或本机编辑器；
- 不做跨机器自动委派（V1 是人操作的统一控制台）。

中央重启不会停止远端 DSH 或远端正在跑的 agent。

## 2. 节点准备（在远端机器上）

1. 正常安装并运行 DSH，保持 `dsh web` 常驻（默认 `127.0.0.1:3080`）。
2. **不要**开 LAN 明文监听。中央只经 SSH 回环访问，仓库策略 `web.lan` 保持
   `false`。
3. 远端不需要安装任何联邦插件。

## 3. SSH alias 准备（在中央机器上）

联邦只接受 `~/.ssh/config` 里的 **alias**，所有连接参数（`HostName`、`User`、
`Port`、`IdentityFile`、`ProxyJump`）都交给系统 OpenSSH：

```sshconfig
Host my-vm
  HostName 198.51.100.10
  User dev
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

要求与限制：

- alias 语法受限为 `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`，不允许空白、控制字符、
  shell 元字符或以 `-` 开头（避免被当成命令选项）；
- 必须**公钥免密**：联邦一律使用 `BatchMode=yes`，不会出现交互式口令提示；
- 首次连接需要先自行确认 host key。未知 host key 会 fail closed，不会自动接受。

保存节点时只做一次**身份探测**（`ssh -N -T -o SessionType=none -o BatchMode=yes`），
不在远端执行任何命令（没有 `command -v`、没有通用 exec）。DSH 是否就绪是后续
独立的一步。

## 4. 节点注册表

路径：`$DSH_HOME/plugins/dsh-federation/nodes.json`

- 目录 `0700`、文件 `0600`，只允许普通文件（拒绝 symlink）；
- 有版本号与 `generation`，写入是 CAS + 临时文件 + `fsync` + `rename`；
- 读取保守：截断、未知版本、权限过宽或 symlink 都**拒绝**，且**绝不**用空配置
  覆盖原文件；
- 只清理本插件自己命名的陈旧临时文件。

手工编辑后如果被拒绝，先看报错类别（`CORRUPT` / `UNKNOWN_VERSION` /
`PERMISSION` / `UNSAFE_PATH`），修好权限或语法即可；不要删掉原文件“重来”。

**多进程并发**：两个 DSH 进程（例如旧 Host 尚未退出、新的已启动）共享同一个
`nodes.json`。已用两个真实并发进程验证：不会写坏文件、generation 只 +1 一次、
落败方以 `CONFLICT` 失败而不覆盖、且不留下临时文件。看到 `CONFLICT` 的正确做法是
**重新读取后再改**，不要强行重写。

该保证依赖一个**跨进程提交锁** `.nodes.json.dsh-federation-lock`（`O_EXCL` 原子创建）：
仅同进程的 CAS 检查不足以阻止两个进程都通过检查后各自 rename（round 20 实测会丢失更新）。
超过 30s 的锁文件视为崩溃遗留并自动回收，因此**不需要手工清理**；若确实看到它长期残留，
说明有进程卡在提交中，应先确认没有活跃的 DSH 进程再删除。详见
`openspec/changes/federated-dsh-control-plane/checking/registry-multiprocess-report.md`。

## 5. 节点状态与排障

| 状态 | 含义 | 首选处理 |
| --- | --- | --- |
| `CONNECTING` | 隧道/探测进行中 | 等待；持续不动看诊断 |
| `READY` | 隧道 + DSH 协议探测都通过 | 正常可写 |
| `DEGRADED` | 可用但有降级信号 | 可写；关注诊断 |
| `SSH_UNREACHABLE` | SSH 层失败 | 见下方 SSH 分类 |
| `TUNNEL_ERROR` | 本地端口 bind 冲突等隧道问题 | 一般自动换端口重试；持续则查本机占用 |
| `DSH_UNAVAILABLE` | 隧道通了但 DSH 没响应 | 远端 `dsh web` 是否在跑、端口是否对 |
| `NON_DSH_SERVICE` | 端口上不是 DSH | 端口配错，指到了别的服务 |
| `INCOMPATIBLE` | 核心 schema/RPC/事件流不满足 | 升级远端 DSH；此状态禁止写 |
| `STALE` | 曾连上、当前断开 | 保留只读树骨架；等重连 |
| `DISABLED` | 节点被禁用 | 需要时再启用 |

SSH stderr 会被**有界采集并脱敏**（私钥、`Bearer`、provider token、真实 home
路径、alias 都会被替换），并分成可执行的类别：

- `HOST_KEY_REJECTED`：host key 未知或变了 → 先人工确认指纹；
- `AUTHENTICATION_FAILED`：公钥/认证不通 → 检查 `IdentityFile`、远端
  `authorized_keys`；
- `ALIAS_OR_DNS_FAILED`：alias 或 DNS 解析不了 → 检查 `~/.ssh/config`；
- `SSH_TRANSPORT_FAILED`：超时/拒绝/无路由 → 网络或远端 sshd；
- `LOCAL_BIND_FAILED`：本机端口冲突 → 由候选端口重试处理。

重要语义：`ExitOnForwardFailure=yes` 只覆盖**本地 listener 建立**。远端端口关闭、
channel 被拒或对端不是 DSH **不会**让 ssh 退出，必须靠 DSH 协议探测识别——所以
只有“自有 SSH 就绪 **且** DSH 探测通过”才会发布回环 endpoint，绝不会出现
false-ready。

## 6. 兼容矩阵

- **SUPPORTED**：**结构性**探测（`host.describe` schema + `workspace.list` +
  `session.list` + 双事件流）全部通过，且版本是 rc.2 实际会报的值 → 开放读写；
- **EXPERIMENTAL**：版本不在已知集合内 → 只开放本次真实探测过的**只读**能力；
- **INCOMPATIBLE**：核心 schema/RPC/事件流失败 → 不可写。

不做 SemVer 推断。

⚠ **版本号不可当作身份**：rc.2 的 `host.describe` 把 `version` 硬编码为
`"0.0.1"`（`dsh-host-apiproxy/lib/index.js:3110`），尽管它自己的注释说是 apps/cli
版本。所以“报 0.0.1”**不能**证明对端不是 rc.2；判定必须靠结构探测。

**可选能力**（缺失是正常部署差异，不是故障）：

| 能力 | 前提 | 缺失时行为 |
| --- | --- | --- |
| `session.search` | sqlite session-query 索引未配置 `openAt: "never"` | 该节点不贡献内容命中，联邦搜索照常返回其他节点结果 |
| `directory.read` / `directory.write` | 远端 composed picker 是 `browse` | 该节点不提供应用内目录流 |

`session.search` 还是**状态相关**的：空日志时探测可能成功，等索引真的要打开时才
拒绝。因此除了启动探测，调用时再遇到远端业务拒绝也会就地降级，不会让整个搜索失败。

实测细节见 `checking/compatibility/rc2-live-conformance-report.md`。

## 7. OUTCOME_UNKNOWN（重要）

写操作有明确状态机：`NOT_SENT → SENT_AWAITING_RESPONSE → ACCEPTED / REJECTED`，
以及断线时的 `OUTCOME_UNKNOWN`。

- 联邦**绝不自动重放**不确定的写操作；
- `prompt` 只能靠远端持久化的 `rpcId` 精确收敛（不做文本匹配）；
- 带 seq/revision 的操作（如 rename）用唯一证据收敛；
- `cancel`、模型切换等没有持久可比证据的操作，可以**无限期**停留在
  `OUTCOME_UNKNOWN`。

处理方式：打开对应远端会话，用远端的权威历史确认到底有没有生效，再手工决定是否
重发。删除仍有 unknown 记录的节点需要显式确认，并会保留最小诊断。

## 8. 隐私边界

- 不提交真实路径、session 历史、截图、token、私钥；
- 诊断与日志做脱敏与最小化；
- `checking/` 下的 fixture 必须是合成、无密的（由
  `npm run check:artifacts` 强制）。

## 9. 禁用与回滚

联邦是可逆开关：

1. `dsh.yaml` 中把 `dsh-federation` 设为 `enabled: false`；
2. 运行 `dsh build`（或 `node scripts/sync.mjs`）；
3. 重启 DSH Web Host。

结果：官方 routes、侧栏、Hero Picker、provider logo、本机 session 与其他插件
完整恢复；远端**没有任何安装物或数据变更**（联邦从未在远端装东西）。

构建期不兼容（rc.2 源码 hash/patch 失配）**不会**产出新 artifact，也不会卸载
上一个可用部署——官方或上一个 last-known-good UI 保持不变。

## 10. 升级 Workspace Embed patch（rc.2 版本变化时）

联邦复用官方 rc.2 Workspace/Session 子树，来源固定到某个 release commit：

1. 更新 `checking/upstream/` 下的 source manifest（commit / blob / sha256）；
2. 重新生成并核对 embed 产物，`npm test` 跑差分与 UI 矩阵；
3. 任一目标 hash 或导出 API 不符 → 构建 fail closed，保留旧部署；
4. 上游正式提供 Embed seam 后，改为直接依赖公开 export 并删掉本地 patch。

Connection compatibility patch（唯一 `/api` outer middleware seam）走同一流程。
