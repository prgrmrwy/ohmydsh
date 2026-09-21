# 失败回滚验收(任务 8.6)

任务原文要求三件事,分别对应三条子断言:

1. 插件组失败 **只撤该组**(不牵连其它组、不留半装状态);
2. runtime 候选失败 **回到旧 manifest / 旧 runtime**;
3. 数据已写新格式时 **先停 writer,再恢复备份**。

**结论:三条全部实测通过,回滚不需要预置"可运行旧运行体快照"。**

---

## 子断言 1:插件组失败只撤该组(本次新增实测)

### 环境

devbox `n37-044-026`,repo `~/opensource/ohmydsh` 对齐 `b5be4b0`(clean),
`$DSH_HOME=/data00/home/zhangyong.617/.dsh`,Node `v22.23.2`(nvm),`dsh build` 走代理。

注入前基线(从 `profiles/web/package.json` 读):

| 观测点 | 基线值 |
| --- | --- |
| `dependencies["dsh-cost-meter"]` | `1.7.30` |
| `dependencies["dsh-width-tiers"]` | `1.0.5` |
| `dsh.profile.bundles` 条数 | `21` |
| `node_modules/dsh-cost-meter/package.json` 实际版本 | `1.7.30` |
| `node_modules/dsh-cost-meter` 目录 mtime | `Sep 21 21:45` |

### 第一次注入:无效,必须记录

把 `dsh.yaml` 里 `dsh-cost-meter` 的 `spec:` 改成 `dsh-cost-meter@99.99.99`,
但 `version:` 保留 `1.7.30`,然后 `dsh build`。

结果:**`exit=0`,耗时 1 秒,零同步动作,部署完全不变。**

**这不是"回滚成功",是测试根本没触发失败路径。** 原因是 sync 的漂移判定读的是
manifest 的 `version:` 字段,而不是 `spec:` 字面量;只改 `spec` 不构成漂移,sync 直接认为
"deployment already matches manifest"。

> 机制含义:想验证失败路径,**必须让 `version:` 也变**。反过来说,`spec:` 单独漂移会被
> sync 静默忽略 —— 这是一个真实的"改了 manifest 却没生效"的坑,值得单独留意。

### 第二次注入:有效

`spec:` 与 `version:` **同时**改成 `99.99.99`(`dsh.yaml` 第 35、36 行),再次 `dsh build`:

```
exit=1,耗时 3s
[sync] version drift dsh-cost-meter 1.7.30 -> 99.99.99, re-adding
 ERR_PNPM_NO_MATCHING_VERSION  No matching version found for dsh-cost-meter@99.99.99
   while fetching it from https://registry.npmjs.org/
 This error happened while installing a direct dependency of .../profiles/web
[sync] ERROR failed to pin dsh-cost-meter
[sync] finished with 1 failure(s):
```

失败被**显式报出**,退出码非 0(不会被误当成成功)。

### 失败后状态:该组原状,其余组未动

| 观测点 | 失败后 | 判定 |
| --- | --- | --- |
| `dependencies["dsh-cost-meter"]` | `1.7.30` | 未被改成坏版本 |
| `node_modules/dsh-cost-meter` 实际版本 | `1.7.30` | **没被卸载、没留半装** |
| 目录 mtime | `Sep 21 21:45` | 与基线一致,目录根本没被重写 |
| `dependencies["dsh-width-tiers"]` | `1.0.5` | 其它组未受影响 |
| bundles 条数 | `21` | 组合表未被截断 |

即:失败是**该组原子失败** —— 依赖表、`node_modules`、bundle 组合三层都停在原值。

### 撤销注入后:幂等恢复

还原 `dsh.yaml` 后 `dsh build`:

```
[sync] no changes — deployment already matches manifest
```

`git status --porcelain dsh.yaml` 为 0 处改动。**坏注入不留残迹,下一次 build 即可收敛**,
不需要手工修 `$DSH_HOME`。

---

## 子断言 2:runtime 候选失败回到旧 runtime

已由 `rollback-drill.md` 完整实测(devbox 往返各一次,干净缓存条件下复验):

`dsh stop` → 恢复升级前 `$DSH_HOME` → 用升级前源码 `git checkout` → **`npm ci`** →
`dsh build` → `dsh restart`,回到 `dshVersion=0.1.2-rc.1`。

关键约束(两次演练共同确认,详见该文):

- **必须连依赖一起退**。只退源码不退依赖会让自研包 build 全挂,
  `admitPromptContent` 之类报错都是依赖不匹配的连带效应,不是独立 bug;
- compat 缓存是浅克隆,回滚时旧构建器取不到旧的 reviewed commit,
  需删掉 `.upstream` / `.storage-upstream` 让它重新克隆;
- 回滚后的 0.1.2 runtime **启动后约 25 秒内返回 403**,之后 200。
  首次探测 403 不等于回滚失败,需重试再判定。

## 子断言 3:数据已写新格式时先停 writer 再恢复备份

已由 `rollback-rehearsal.md` 论证 + `rollback-drill.md` 在 live `$DSH_HOME` 上执行。

- v3 迁移是**惰性且增量**的:升级后被打开且**迁移前为空**的会话,
  `session.jsonl.zstd` 停在 header-only(334 B),内容只在 `session.v3.jsonl.zstd`;
  升级后**新建**的会话**只有** v3 文件,连旧文件名都没有 → 旧 runtime 完全看不到。
- devbox 实测分流:`仅 v3` 4 个目录、`两者都有` 7 个、`仅旧代` 33 个(共 44)。
  升级前备份里是 `0 个 v3 + 40 个旧代`。
- 所以**只回退 `dsh.yaml` 不是回滚,会造成静默的历史丢失**;真正的回滚物是 `$DSH_HOME` 备份。
- 恢复前必须 `dsh stop` 停 writer(确认端口释放、无残留进程),否则备份会被正在写的进程污染。
- 演练用**重命名而非删除**搬运 `$DSH_HOME`;往返结束后 Pet 数据不变
  (`loci=1 deliveries=1 tasks=2 invocations=1 channel_config=1`),
  会话仍为 `plain 40 + v3 11`。

---

## 对 host/lumevm 的运维含义

1. 插件升级失败**可以放心重试**:坏 pin 不会把 `$DSH_HOME` 弄脏,修好 manifest 再 build 即收敛。
2. 升级前 `$DSH_HOME` 备份是**必做项**,不是可选项 —— 它是唯一能带回 v3 会话的回滚物。
3. 回滚四步不可省:`dsh stop` → 恢复备份 → 旧源码 + `npm ci` → build + restart。
4. 回滚后别用"第一次探测 403"判死,等 25 秒重试。
