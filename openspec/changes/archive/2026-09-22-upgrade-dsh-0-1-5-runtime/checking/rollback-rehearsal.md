# 从 0.1.5 新格式回滚到 0.1.2-rc.1 的演练(任务 3.5)

## 结论先行

**只把 `dsh.yaml` 改回旧版本不是回滚,会造成静默的历史丢失。**
正确顺序是三段式,顺序错了就是单向门:

1. **停 writer**(`dsh stop`,确认端口释放、无残留进程)
2. **恢复升级前的 `$DSH_HOME` 备份**
3. **再退回旧 runtime**

## 为什么不能只回退 manifest

Session 日志的 v3 迁移是**惰性**的(第一次被打开时才转换),且迁移是**增量**的:
转换不会覆盖原文件,而是**新增**一个带版本后缀的文件,把旧代原样留下。

在 devbox 上直接取证的三种代形(同一台机、同一个 home):

| 情形 | 磁盘实际内容 | 旧 runtime 会看到什么 |
|---|---|---|
| 升级前就存在、**升级后从未打开** | 只有 `session.jsonl.zstd`(共 33 个目录) | 正常 —— 未迁移,不受影响 |
| 升级后被打开、**迁移前为空** | `session.jsonl.zstd` 停在 334 B(仅 header,`"version":0`)**且** `session.v3.jsonl.zstd` 5 973 B(写入时间 20:44) | **空会话** —— 旧文件是 header-only,读到一个"存在但没有内容"的会话 |
| **升级后新建** | **只有** `session.v3.jsonl.zstd`(36 316 B,21:48),连旧文件名都没有 | **完全看不到这个会话** —— 36 KB 数据在盘上,但旧 runtime 按旧名解析不到 |

第三种情形是决定性的:Pet 当前活跃 locus 的 parent session
`session-7f0f6559-b314-4361-8cfc-bce023e7b2e7` 就落在这一类——目录里只有
`session.v3.jsonl.zstd` 和 `session.lock`。

两条 header 直接读出代际差异:

```
session.jsonl.zstd      -> {"type":"session","version":0,"id":"session-93f44ef3-..."}
session.v3.jsonl.zstd   -> {"type":"session","version":3,"id":"session-93f44ef3-..."}
```

devbox 当前分流:`仅 v3` 4 个目录、`两者都有` 7 个目录、`仅旧代` 33 个目录
(合计 44 个会话目录)。升级前备份里则是 **0 个 v3 + 40 个旧代**。

### 一个必须记住的读数陷阱

这些日志是**多帧 zstd**:`session.jsonl.zstd` 334 B 含 2 个帧魔数,
`session.v3.jsonl.zstd` 5 973 B 含 23 个,一个忙碌会话 280 990 B 含 95 个。
Node 的 `zstdDecompressSync`(以及本次实测的 `createZstdDecompress` 流式接口)
都**在第一个帧就停**,于是任何朴素解码器都会把任意会话报成"1 行"。
第一次读这两个文件时正是得到 `rows=1`,差点据此得出错误结论。
要拿真实行数必须自己迭代帧。

## 备份才是回滚物

升级前备份是可用的回滚基线,其形态为**三件套**(不是目录拷贝):

```
/data00/home/zhangyong.617/dsh-backup-20260921-161053/
  dsh-home.tgz     115 MB   ← $DSH_HOME,内含 40 个旧代 session 日志
  ohmydsh-src.tgz  123 MB   ← 当时仓库源码
  src-head.txt               ← 当时的 HEAD = 986b932403f30510b00964782ccb912599300a85
```

恢复后必须核对的完整性检查:

- `find $DSH_HOME/sessions -name 'session.v3.jsonl.zstd' | wc -l` 应为 **0**;
- 会话目录数与备份内 `session.jsonl.zstd` 数量一致(本机 40);
- `dsh-startup.log` 里 runtime 记录回到 `0.1.2-rc.1`;
- 旧 runtime 起来后能列出并 resume 这些会话。

## 本次实际演练到什么程度(诚实边界)

**已做**:以只读方式做了受控对照实验——把升级前备份解到
`/tmp/rollback-rehearsal/pre`,再构造 `mixed`(升级前的 profile,只把 11 个
v3 日志换进去),分别用 `@deepseek-ai/dsh@0.1.2-rc.1`(npx 现装,
`~/.npm/_npx/2f3a729d991ac520`)在 **3200 / 3201** 非生产端口启动:
两者都能起来(旧 runtime **没有**启动期格式守卫),启动日志无格式/版本报错;
取证完成后已终止这两个实例。上表的三代形态与 header 版本即由此得到。

**未做,且刻意不做**:没有对 **live** `$DSH_HOME` 执行"停 writer → 覆盖恢复
备份"这一步。因为最近的可用回滚备份(16:10)是升级前的,恢复它等于**删除**今天
20:57 之后产生的 Pet locus / delivery 数据。这属于破坏性操作,
在身份与状态可证明之前不执行——需要用户明确批准才能对运行中的 home 真做一次。

因此本任务完成的是**回滚路径的可判定性**:危险被量化、正确顺序被固定、
备份被验证为旧代格式、失败模式被复现。剩下的"真按下去一次"是有意留给用户的决定。
