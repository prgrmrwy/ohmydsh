# DSH 会话协作

[English](README.md) · 简体中文

<!-- problem -->
同一Host中的独立会话可以在不同仓库工作，但需要一份权威共享台账和定向下一回合通知。本bundle把已有普通会话接入独立协作内核，不把一级会话改造成团队，不创建子会话。是否启用由manifest的`enabled`决定，profile登记了bundle就加载。

## 配置

在manifest里把dsh-collab设为`enabled: true`，`dsh build`后`dsh restart`即可，不需要任何本机路径配置。数据目录默认是`<DSH home>/plugins/dsh-collab`：DSH home取Host进程环境中非空的`DSH_HOME`，否则为`~/.dsh`。存储位置只由Host配置和进程环境决定，不能由会话参数或模型输入选择。以下键都可选，需要时在profile补丁里按行id覆盖：

```yaml
- id: dsh-collab
  name: dsh-collab
  config:
    dataDir: /absolute/profile-owned-state/collab   # 可选；须为绝对路径，缺省用上面的默认目录
    admission: invite            # 默认；allowlist 恢复首版名单准入
    allowedSessionIds: []        # invite 下仅作 collab_status 的种子联系人
    denySessionIds: []           # 排除名单：既不能调用，也不能被认领或唤醒
    memberTrust: true            # 默认；false 恢复手动 join 与"不是授权"的唤醒说明
```

**准入模式。** `invite`（默认）：通过普通会话校验的一级会话都可以建空间；被Leader用完整session ID邀请并认领的会话即获准进入该空间，授权记录就是台账里的`member/invited`提交，无需改配置或重启。`allowlist`：额外要求调用者与被邀请者在`allowedSessionIds`中，旧配置原样可用。两种模式下subagent、非零delegationDepth、已归档、官方所有权拒绝或位于`denySessionIds`的会话都不能调用、不能被认领。非法`admission`、列表含空串/首尾空白/重复项、或同一ID同时在两个列表时插件拒绝启动（`COLLAB_BAD_CONFIG`），不注册工具也不创建dataDir。**修改排除名单或准入模式后必须`dsh build`并`dsh restart`才生效**，没有热更新。

**成员信任。** `memberTrust: true`（默认，两种准入模式都生效）表示操作者预先同意：`collab_invite`成功后，宿主以刚认领的被邀请会话身份代为join（保留cmdId `dsh-collab:auto-join`，重试幂等；返回多一个`autoJoined`），唤醒说明告诉成员可以承接空间成员派发的request，并**在本会话原有权限边界内**直接执行，无需再向用户确认。沙箱、审批、worktree限制不变；人类决定仍只能来自`requestDecision`。`memberTrust: false`恢复手动join，唤醒说明逐字恢复原文。新空间记录约定v2，v1空间继续读取v1。

**信任面。** 同一Host上任一普通会话的agent都可按完整ID邀请并唤醒另一个普通会话，每次唤醒消耗对方一次模型调用。开启成员信任（默认）时，邀请还意味着邀请方可以在被邀请方自身权限内指挥其工作。插件**不限制邀请数量，也不限制累计唤醒次数**；约束只有每成员每空间6次的普通唤醒熔断、排除名单，以及（关闭成员信任时）被邀请方可以拒绝。需要时把会话加入排除名单、设`memberTrust: false`，或切回`allowlist`。

**数据目录前提。** 一个dataDir在整个生命周期内只能由**一个Host进程**使用，且不经网络盘、VM共享目录或容器挂载被其它pid命名空间访问（例如宿主机与LumeVM共用目录即违反）。违反时启动清锁可能删掉另一个Host正持有的锁，造成双写；同机两个Host误配也不保证安全。数据目录不能在任何声明workspace或node_modules部署目录内。新目录0700；既有目录若group/other可访问则拒绝，不偷偷改权限。serviceId由canonical dataDir摘要稳定派生。构建内联当前内核源码，运行不依赖workspace内核包。

## 工具与信任

12个常驻工具，所有会话同一份定义（真实request header中合计≤4200字符）：

- `collab_status`：**唯一入口**。被唤醒或开始协作时先调用它，返回所在空间、待处理事项（ack、待回复消息、承接的request、escalated）、待处理邀请、种子联系人和固定枚举的下一步建议；不含任何标题、正文或状态文本，不合规的spaceId/itemId（须匹配`^[a-z0-9][a-z0-9-]{0,63}$`）不出现。它是纯读取：不打开空间、不写台账、不唤醒、不采样presence。
- `collab_space`（`create|close`）、`collab_invite`、`collab_member`（`join|decline|leave|mark_gone|transfer_leader`）、`collab_read`（`overview|since|convention`）。
- `collab_create_item`、`collab_revise_item`、`collab_ack_item`、`collab_send_message`、`collab_set_status`、`collab_advance_request`、`collab_request_decision`。

写命令要求稳定非空cmdId，同一成功命令重试返回原收据。写命令返回`COLLAB_SPACE_UNAVAILABLE`时结果未知，应稍后用原cmdId与相同参数重试。"空间不存在""不是成员"和所有存储错误（锁、损坏、写失败）对模型一律是`COLLAB_SPACE_UNAVAILABLE`；锁身份与诊断只写宿主日志。唯一例外是创建已存在的spaceId返回`COLLAB_SPACE_EXISTS`。邀请不自动join，join前读取返回`COLLAB_MEMBER_INACTIVE`。

身份仅取真实exec.agent，参数不能提供principal/actor/provider或调用者会话。冷目标核验只读会话header元数据，不读正文、不恢复agent，不返回其它会话的ID或cwd；插件不提供列出全部会话的工具。通知只带白名单指针、插件来源和"先调用collab_status"的提示，不带业务正文/标题，不授予用户或workspace权限。忙碌会话followup进入下一回合，不steer当前回合。

成功投递仅表示**Host接受入队**，不表示落盘、模型完成或用户同意。入队到session flush间崩溃可能丢指针；未知/失败不自动重发，台账仍是真源。没有人类确认或breaker reset模型工具；纯agent空间请求决定返回COLLAB_NO_DECIDER。

## 恢复

| 情况 | 恢复手段 |
|---|---|
| 残留锁（Host被SIGKILL、崩溃或超过关停预算） | `dsh restart`：启动时扫描全部`*.lock`（含没有日志的孤儿锁），锁内pid经本机探测返回ESRCH且删除前字节未变才清理并写日志，有日志的空间随后打开。pid存活、被复用、EPERM或锁损坏时保留并写一行诊断；此时改用新spaceId，或停止Host后人工删除该锁文件。运行期从不自动解锁。 |
| 日志中间损坏 | 停止Host后执行离线抢救，或随时换新spaceId重建（无需停机）。 |
| 运行期写失败（磁盘满、fsync报错） | 修复磁盘后`dsh restart`。 |

离线抢救只在Host停止时执行：

```sh
dsh-collab-salvage --data-dir /absolute/profile-owned-state/collab --space-id SPACE
```

它排他加锁，按存储加载规则保留首个坏行之前的合法前缀，写临时文件并fsync，以硬链接把原件备份为`SPACE.jsonl.corrupt-<UTC时间戳>`，再原子替换（没有合法记录时删除日志，原ID可重新创建），最后释放锁。原件始终保留。输出保留记录数与首个坏行行号。**被丢弃命令的收据随之丢失；抢救后seq会被复用，成员须把读取游标重置为0（`collab_read`的lastSeq小于自己的游标时从0重读）；有agent参与的空间建议直接换新spaceId。**发现`.salvage-tmp`已存在时拒绝并列出文件状态，唯一允许的人工动作是确认日志为原损坏文件后删除tmp再重跑。残留锁与损坏同时存在时，先启动一次Host清理残留锁，再停机抢救。

## 验证

见[隔离测试说明](test/README.zh.md)。仅临时home、合成会话和本地脚本模型；正常停止、预算耗尽和SIGKILL分别验证，后两者由下一次官方启动自动清锁并重放。组件通过不等于全部consumer场景完成。不修改日常profile/GUI。

## 移除
<!-- section: removal -->
本插件连接普通DSH会话执行与独立协作内核。不再需要时禁用/移除bundle及manifest项，再按另行授权构建/重启。dispose撤销工具并关闭已接纳存储，保留协作日志；不删除workspace或会话数据。独立内核仍可单独使用和移除。
