# Gate 卫生边界:任务 9.6 与 9.7

## 结论先行

| 任务 | 判定 | 一句话 |
| --- | --- | --- |
| 9.6 | **满足**,并查出并修掉一处真实卫生缺陷 | fixture 与迁移素材都符合"可复核、不拿候选 checkout 当被测对象";但升级前备份曾是**全局可读** |
| 9.7 | **条件未触发,按实质要求满足** | GUI 验收在 devbox 本机直连完成,**没有建立任何 SSH tunnel**,故"本地转发端口"这一面不存在;本机 3080 Host 全程未被触碰 |

---

## 9.6 数据迁移与 fixture 卫生

原文要求:数据迁移使用 owner-only 的脱敏真实副本或结构等价 fixture 并记录差异/hash/oracle;
Worktree 使用 `$RUN_ROOT/fixtures/repo` disposable Git 仓库,**不得拿候选 checkout 当被测仓库**。

### 迁移素材与 oracle

- 素材是**升级前 `$DSH_HOME` 的真实副本**,不是合成 fixture:
  `/data00/home/zhangyong.617/dsh-backup-20260921-161053`,
  `src-head.txt` = `986b932403f30510b00964782ccb912599300a85`。
- oracle 与逐项差异记录在 `session-migration-acceptance.md` /
  `rollback-rehearsal.md`:身份、标题、workspace/cwd、lineage、provider、
  assistant/tool 内容,以及迁移前后分流。

### 差异读数

| 观测点 | 升级前备份 | devbox 迁移后 |
| --- | --- | --- |
| 会话目录 | `0 个 v3 + 40 个旧代` | `仅 v3` 4 / `两者都有` 7 / `仅旧代` 33(共 44) |
| 会话口径 | — | `plain 40 + v3 11` |

> ⚠ **读数陷阱(会影响 hash/行数对比的有效性)**:Session 日志是**多帧 zstd**。
> 朴素解码器**在第一个帧就停**,会把任意会话报成「1 行」
> (`session.v3.jsonl.zstd` 5 973 B 实含 23 个帧,一个忙碌会话 280 990 B 含 95 个)。
> 任何"迁移前后行数一致"的结论,只有用能处理多帧的方式解码才作数。

### Worktree fixture:确认不是候选 checkout

| 观测点 | 值 |
| --- | --- |
| 路径 | `/tmp/wt-fixture/repo`(devbox,disposable Git 仓库) |
| HEAD | `8463e19 chore: 加 npm lockfile(Worktree Session 要求 npm/pnpm 项目)` |
| 工作区 | clean(0 处改动) |
| 文本素材 | `/tmp/wt-fixture/note.txt`,38 B,sha256 `2bbef9c8…cbbe7` |
| 图片素材 | `/tmp/wt-fixture/pixel.png`,79 B,sha256 `b475f66e…8c5bcdd` |

它是一个**独立的空仓库**,不是 `~/opensource/ohmydsh` 候选 checkout —— 满足
「不得拿候选 checkout 当被测仓库」。首发验收见 `worktree-first-submission.md`。

### 查出的缺陷:升级前备份曾全局可读(已修)

修复前实测:

```
/data00/home/zhangyong.617/dsh-backup-20260921-161053          755   ← 非 owner-only
        .../dsh-home.tgz   115 424 468 B                        644   ← world-readable
        .../ohmydsh-src.tgz 122 915 543 B                       644   ← world-readable
        .../src-head.txt                                         644
```

对照**源目录本身是收紧的**:

```
~/.dsh            perms=700
~/.dsh/sessions   perms=700
```

也就是说备份把权限**放宽**了:一个 `700` 的生产 home 被摊成了 `755`/`644`。
这台 devbox 是共享机器(同机还有另一个用户 `prgrmr` 的 checkout 与 Host 在跑),
所以这不是理论问题 —— session 内容与凭据面在机器上是**任何本地用户可读**的。

**处置**(已执行并复验):

```
chmod 700 <backup-dir>; chmod 600 <backup-dir>/*.tgz <backup-dir>/src-head.txt
```

| 观测点 | 修复前 | 修复后 |
| --- | --- | --- |
| 备份目录 | `755` | **`700`** |
| `dsh-home.tgz` | `644` | **`600`** |
| `ohmydsh-src.tgz` | `644` | **`600`** |
| `src-head.txt` | `644` | **`600`** |
| 完整性 | — | `dsh-home.tgz` 18 214 条目 / `ohmydsh-src.tgz` 33 355 条目,`src-head.txt` 仍为 `986b9324…` |

另一次备份(`dsh-backup-20260921-214127`)本就是 `700`,无需处置。

> **运维含义**:备份步骤必须显式收敛权限(见 `host-lumevm-deployment-readiness.md`
> 的 apply 序列)。`tar` 出来的产物默认继承 umask,在共享机器上就是上面这个结果。

### 未提交原始数据

原始 session / history evidence **未提交**,只提交脱敏报告 —— 符合仓库约定
(「不提交可重建产物、批量截图或 raw session/history evidence」)。

---

## 9.7 GUI 隧道与本地 Host 无关性

原文要求:GUI **需要时才**以严格 OpenSSH 参数建立 loopback tunnel,本地端口不得 3080;
HTTP/DSH probe 才算 ready;浏览器使用临时独立 profile;前后记录本地 3080 Host
PID/start/健康不变。

### 实际做法:没有用 tunnel

GUI 验收**在 devbox 本机完成** —— 直接用 devbox 自己缓存的 Chromium 连
**devbox 侧的**真实 origin `http://127.0.0.1:3080`,不是把远端端口转发到本机。
因此:

- 「本地转发端口不得为 3080」这一条**没有适用对象**(不存在本地转发端口),
  也就不存在与本机 3080 冲突的可能;
- 也省掉了「tunnel ready 判定」与「readiness 靠 probe 而非进程存在」这两个易错面,
  证据链更短。

这条路径本身有两个**实测约束**(不是可选项):

- devbox 的 `/usr/bin/chromium` 是 **Chromium 90**,跑不动 0.1.5 客户端
  (`Promise.withResolvers is not a function`,渲染出空白页)。必须用缓存里的
  Chrome for Testing 148(`~/.cache/ms-playwright/chromium_headless_shell-1223/…`)。
  用 90 得出的"无错误"是**无效结论**。
- devbox **无中文字体**:截图里中文是豆腐块,但 DOM 文本 dump 正常 →
  **判定一律走 `document.body.innerText`,不靠截图读中文**。

浏览器一律用**临时独立 profile**(`--user-data-dir=/tmp/cdp-*`),不复用任何既有 profile。

### 本机(=host)3080 前后不变:实测

| 观测点 | 值 | 说明 |
| --- | --- | --- |
| PID | **84619** | 与本次 change 开始时记录的 pid 一致 |
| 启动时间 | `2026-09-20 15:45:12` | 若被重启过,这会变 —— 没变 |
| 监听 | `127.0.0.1:3080 LISTEN` | — |
| 健康 | **HTTP 401** | 未带凭据 → 401,符合 Host fence(不是故障) |
| 部署 runtime | `node_modules/@deepseek-ai/dsh-session` = **`0.1.2-rc.1`** | 本机尚未 apply,符合预期 |

本机 3080 上跑的是**主 checkout** 的 launcher
(`/Users/bytedance/mydir/opensource/ohmydsh/packages/dsh-pet/compat/subagent/.launcher/`),
不是本次验收用的 worktree —— 所以本次全部改动都没有落到它的运行面上。

> **诚实边界**:上表是"本次 worktree 工作期间"的前后一致,不是"从 launch 至今从未重启"
> 的完整证明(启动时间戳一致是它的佐证)。本机 apply 由用户执行,完成后可另行留机器级证据
> (见 `host-lumevm-deployment-readiness.md`,任务 10.4 已声明本 change 不远程操作 host/lumevm)。

---

## 仍未覆盖

- 9.6 只验证了**两处**备份的权限;若日后新增备份路径,需重新检查(未做系统性扫描)。
- 9.7 未验证「经 tunnel 访问」这条**备用路径**能否工作 —— 本次刻意不用它,故它是
  未验证状态,不能写成可用。
- devbox 上另一个用户(`prgrmr`)的 checkout 与 3081 Host 全程未被检查或干预,
  它们是否也存在同类权限放宽**未知**。
