# 回滚演练(devbox 实测):**回滚可行**,但必须连依赖一起退

任务 3.5 的 live 部分。做成完整往返:回滚 → 验证 → 再前滚回去,两轮都跑通。

> ⚠ **本文档前一版结论是错的,已作废。** 前一版写"naive 回滚不成立、旧运行体回不去",
> 依据是只 `git checkout` 旧源码就跑 `dsh build` 的那次失败。**缺的是 `npm ci`。**
> 补上这一步后整条路径完全走通。错误根因:我没有把"源码"与"依赖"当成一个整体,
> 只退了一半就开始下结论。(同类错误见 memex 卡
> `acceptance-control-group-must-be-identity-checked`。)

## 最终验证过的回滚流程(devbox 实测)

```
1. dsh stop                                   # 停 writer
2. 恢复升级前的 $DSH_HOME 备份                 # 数据先回
3. git checkout <升级前 commit>                # 源码回退
4. npm ci                                     # ★ 依赖必须一起退(缺这步必失败)
5. dsh build                                  # 旧运行体 + 旧插件集物化
6. dsh restart                                # 启动器只认 build/stop/restart
```

实测数据(升级前 commit `986b9324`,从 0.1.5-rc.2 退回):

| 步骤 | 结果 |
|---|---|
| `dsh stop` | exit 0;端口释放、无残留进程 |
| 恢复升级前 `$DSH_HOME` | `dshVersion=0.1.2-rc.1`、plain 40 / **v3 0** |
| `npm ci` | exit 0(5s,缓存热);`@deepseek-ai/dsh-session` → **0.1.2-rc.1** |
| `dsh build` | **exit 0,143s,零失败** `[sync] done — 3 change(s) applied` |
| `dsh restart` | exit 0,77s → `dshVersion=0.1.2-rc.1`,compat fingerprint `21c414e4…` |
| 界面 | `index=200`;无 token 401(fence 正常) |
| Pet | `ready — routes registered` + `channel: subscription connected` |
| 当前日志段错误 | **0** |

前滚(对称,也走 `npm ci`)同样两次都通过:依赖回到 `0.1.5-rc.2`、home 恢复后
plain 40 / v3 11、`dsh build` exit 0、`dsh restart` exit 0、四通道全 200。

## 两个必须记住的坑

### 坑 1:只退源码不退依赖 → 自研包 build 全挂

跳过 `npm ci` 时:

```
[sync] finished with 3 failure(s):
  - local package dsh-worktree-session: … failed before deployment
  - local package dsh-pet:              …
  - local package dsh-session-links:    …
```

- `dsh-worktree-session`:`tsc -p tsconfig.json` 退出 2 —— 旧源码期望旧类型,而
  `node_modules` 里是升级后的 DSH 包;
- `dsh-pet`:`build:runtime-compat` 失败,并在强制重克隆后暴露为
  `@deepseek-ai/dsh-attachment does not provide an export named 'admitPromptContent'`。

**原先被我当成"独立 bug"的 `admitPromptContent` 就是依赖不匹配的连带效应** ——
`npm ci` 之后它自行消失,`dsh build` 零失败。不要再把它当独立缺陷排查。

### 坑 2:compat 缓存是浅克隆,拿不到旧的 reviewed commit

跳过缓存处理时,启动器准备旧运行体会失败:

```
Error: git checkout --detach a66e4702047846cdaa10c66c9d3df3951f5ea70d exited 128
error: 无法准备 customization Host runtime:Host runtime compatibility builder exited 1;
       refusing official-runtime fallback
error: 无法解析 DSH Host runtime(@deepseek-ai/dsh@0.1.2-rc.1)
```

`.upstream` / `.storage-upstream` 是**浅克隆、只钉当前 reviewed commit**,所以
`git checkout --detach <旧 commit>` 退出 128;而启动器**拒绝降级到官方运行体**,
于是 Host 完全不启动。

**处置**:删掉缓存让构建器重新克隆 —— 实测删除后旧构建器**正确地**重新克隆到
`a66e470 release(dsh): 0.1.2-rc.1`:

```
rm -rf packages/dsh-pet/compat/subagent/.upstream packages/dsh-pet/compat/subagent/.storage-upstream
```

⚠ 注意新版 `build.mjs` 已有陈旧缓存探测(`git cat-file -e` + 重克隆),
**但回滚时跑的是旧代码,里面没有这个修复**,所以只能手工删缓存。
(该探测在本次前滚中被实测验证:`.upstream` 被删后新构建器按探测重克隆并构建成功。)

**诚实边界**:最终跑通的那次 `dsh build` 里,缓存已经在旧 commit 上(是前一次失败尝试
重克隆留下的)。所以"干净缓存 + `npm ci`"的组合是**由两半各自的观测推出**的,
没有在一次连续运行里合并验证过。按上面的处置做应当没问题,但严格说这一步仍属推断。

### 附带:`dsh start` 不是合法动词

启动器只接受 `build` / `stop` / `restart`(裸 `dsh` 也可启动)。
任何写 `dsh build && dsh start` 的流程都会在第二条命令报"无法识别的参数"。

## 演练未伤数据

两轮演练(回滚 + 前滚)之后,Pet 数据与演练前**逐项一致**:
`loci=1`、`locus_deliveries=1`、`tasks=2`、`invocations=1`、`channel_config=1`;
会话 `plain 40 + v3 11`。关键做法是**用重命名而非删除**搬运 `$DSH_HOME`,
并在动任何东西之前先取"升级后"备份。

## 对 host/lumevm 的含义

**回滚可用,不需要预置"可运行旧运行体快照"。** 用升级前的源码 + `npm ci` + `dsh build`
即可重建旧运行体。升级前的准备因此简化为:

1. `$DSH_HOME` 备份(**必做**,防惰性 v3 迁移造成的不可读);
2. 记下升级前的 commit SHA(`src-head.txt` 已有此作用);
3. 升级后如需回滚,按上面的六步走,注意两个坑。

`npm ci` 需要网络(仓库依赖来自 registry),回滚机器要能出网或走代理。
