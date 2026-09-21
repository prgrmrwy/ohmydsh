# 回滚演练(devbox 实测):数据回得去,旧运行体回不去

任务 3.5 的 live 部分。此前只做过只读取证(`rollback-rehearsal.md` 记录了三种会话代形态)。
本次在 devbox 上**真的按了一遍**,做成完整往返:回滚 → 验证 → 再前滚回去。

结论先行:**naive 回滚路径(改回 manifest → build → 重启)不成立。**
数据可以恢复,**旧运行体在当前机器状态下起不来**。

## 执行序列与实际结果

| # | 步骤 | 结果 |
|---|---|---|
| R0 | 预检 + 取"升级后"全新备份(17414 项 / 403 MB) | ✅ |
| R1 | `dsh stop` 停 writer | ✅ 端口释放、无残留进程 |
| R2 | 恢复升级前 `$DSH_HOME`(16:10 备份) | ✅ 身份核对:`dshVersion=0.1.2-rc.1`、plain 40 / **v3 0** |
| R3 | 退回旧运行体 | ❌ **三处阻塞,见下** |
| R4 | 前滚回 0.1.5-rc.2 | ✅ build exit 0、Host 起来、四通道 200 |
| R5 | 全面验证 | ✅ 见"最终状态" |

R2 用的是**重命名**而不是删除(`~/.dsh` → 保留目录),所以每一步都可逆;
整个演练**没有伤到 Pet**。

## R3 的三处阻塞(逐条实测)

### 阻塞 1:源码回退但不重装依赖 → 自研包 build 失败

```
[sync] finished with 3 failure(s):
  - local package dsh-worktree-session: npm run build --workspace … failed before deployment
  - local package dsh-pet:              …
  - local package dsh-session-links:    …
```

`worktree-session` 的失败是 `tsc -p tsconfig.json` 退出 2 —— 旧源码期望旧类型,而
仓库 `node_modules` 里装的是升级后的 DSH 包版本,类型对不上。`dsh-pet` 则是
`build:runtime-compat`(compat 构建)失败。

**含义**:回滚必须把仓库依赖也退回去(`npm ci` 或等价重装),不能只 `git checkout`。

### 阻塞 2:启动器无法准备旧 compat 运行体,且拒绝降级到官方运行体

```
Error: git checkout --detach a66e4702047846cdaa10c66c9d3df3951f5ea70d exited 128
error: 无法准备 customization Host runtime:Host runtime compatibility builder exited 1;
       refusing official-runtime fallback
error: 无法解析 DSH Host runtime(@deepseek-ai/dsh@0.1.2-rc.1)
```

`packages/dsh-pet/compat/subagent/.upstream` 是**浅克隆、只钉在新的 reviewed commit**
(`fb2c4b9e`),拿不到旧 compat commit `a66e4702` → `git checkout --detach` 退出 128。
而启动器**明确拒绝回退到官方运行体**(`refusing official-runtime fallback`),
于是 **Host 完全不启动**(3080 无进程)。

⚠ 讽刺的是:这个"陈旧 compat 缓存"的缺陷我在**新**代码里已经修了
(`git cat-file -e` 探测 + 重克隆,见 memex 卡 `devbox-real-deployment-path-defects`),
但**回滚时跑的是旧代码,里面还没有这个修复**。

### 阻塞 3:强制重克隆后,旧 compat 构建仍然失败

删掉 `.upstream` / `.storage-upstream` 后重试,旧构建器**正确地**重新克隆到
`a66e470 release(dsh): 0.1.2-rc.1` 并开始构建,但随后:

```
import { AttachmentError, admitPromptContent } from "@deepseek-ai/dsh-attachment";
SyntaxError: The requested module '@deepseek-ai/dsh-attachment' does not provide an export
             named 'admitPromptContent'
```

即旧树构建期解析到的 attachment 包与引用方版本不匹配。**即使强制重克隆也产不出可用的旧运行体**——
这一条需要单独排查(未定根因),不能靠删缓存绕过。

### 附带发现:`dsh start` 不是合法动词

```
error: 无法识别的参数 'start'
```

启动器只接受 `build` / `stop` / `restart`(裸 `dsh` 也可启动)。
任何写 `dsh build && dsh start` 的流程都会在第二条命令失败。

## 确实成立的部分

- **顺序本身是对的**:先停 writer、再恢复数据、最后谈运行体。R1+R2 干净通过。
- **数据完全可恢复**:恢复升级前 home 后,v3 日志归 0、plain 40 个,即回到旧运行体可读的状态。
- **前滚很顺**:恢复升级后 home → 回 `main` → `dsh build`(exit 0)→ `dsh restart`(exit 0)。
  而且**新 `build.mjs` 的陈旧缓存探测确实起作用**——我在演练中把 `.upstream` 整个删掉,
  新构建器按探测重新克隆并构建成功,这是那处修复的实测验证。
- **演练未伤数据**:Pet `loci=1 / deliveries=1 / tasks=2 / invocations=1 / channel_config=1`,
  与演练前逐项一致。

## devbox 最终状态(演练后核验)

| 项 | 值 |
|---|---|
| 运行体 | `0.1.5-rc.2`,pid `2264866` |
| 会话日志 | plain 40 + v3 11 |
| 四个 Connection RPC 通道 | guard / clock / session-links / memex **全 200**;`/` 200 |
| 当前日志段错误 | 0 |
| Pet | `ready — routes registered` + `channel: subscription connected` |

## 对 host/lumevm 的含义(重要)

**今天在 host/lumevm 上:数据救得回来,旧运行体回不去。**
在做完下面任一件事之前,应把这批升级当作**单向**的,备份的意义是"数据保险"而不是"可运行的退路":

1. 把回滚演练做通(阻塞 1 靠重装依赖,阻塞 2 靠预置/加深 compat 缓存,
   阻塞 3 需要单独定位);或
2. **预置旧运行体快照**——升级前把"能跑起来的完整工作集"整体留档,
   而不仅是 `$DSH_HOME`:至少还要包含仓库依赖(`node_modules`)、
   compat 缓存(`.upstream` / `.storage-upstream` / `.launcher-builds`)
   与按版本解析出的官方 CLI(`~/.cache/ohmydsh/dsh-cli/<version>`)。
   现有三件套备份(`dsh-home.tgz` + `ohmydsh-src.tgz` + `src-head.txt`)
   **不含后两类**,所以按现有备份恢复不出可运行的旧运行体。

方案 2 更省事且不依赖定位阻塞 3,建议在升级 host/lumevm 前先补上。
