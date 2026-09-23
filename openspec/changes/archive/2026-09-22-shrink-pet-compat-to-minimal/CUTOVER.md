# Pet storage 切换 — 操作手册

把 Pet 的持久化从「打过补丁的官方 backend」切到「Pet 自己注册的 backend」。

**总耗时约 5 分钟**，其中 Host 停机约 2 分钟。

---

## 开始前

**不需要迁移数据。** 两个 backend 的磁盘格式完全一致（同样的 `u_<unit>_<table>`
表名、同样的 `units` 版本戳），变的是谁来读写，不是文件长什么样。唯一的运行时
差异是 `journal_mode` 由 `wal` 改为 `delete`（排他锁与 WAL 不兼容），SQLite 在
打开时就地完成，数据无损。第 2 步会在**副本**上先证明这一点。

所有命令都在仓库根目录执行：

```bash
cd /Users/prgrmrwy/opensource/ohmydsh
```

---

## 1. 停止 Host

```bash
dsh stop
```

确认进程已退出：

```bash
ps aux | grep "dsh/lib/bin.js web" | grep -v grep
```

**应该没有输出。** 若仍有进程，等几秒再看；始终不退再手动 `kill <PID>`。

> 这一步必须真的完成。Pet 的库在运行时被 Host 独占，没停干净的话第 2 步会
> 直接拒绝（这是设计的一部分，不是故障）。

---

## 2. 备份 + 兼容性预检

```bash
node packages/dsh-pet/scripts/preflight-storage-cutover.mjs
```

**期望输出：**

```
✓ 备份完成,完整性检查通过
  大小: 536.0 KB
  域版本: dsh_pet v15
  记录数: 441

✓ 兼容性演练通过(在副本上)
  journal_mode: wal → delete,记录数不变
  独占锁: 可获取

可以重启 Host。若需回滚:
  cp "…/state.sqlite.pre-storage-cutover-….bak" "…/state.sqlite"
```

**把「记录数」和那行回滚命令记下来**，后面要用。

这个脚本只读原库、只写备份文件，演练全在副本上做，**不会改动生产数据**。

### 如果它报错

| 输出 | 含义 | 怎么办 |
|---|---|---|
| `Pet 数据库正被占用` | Host 没停干净 | 回到第 1 步 |
| `快照完整性检查未通过` | 原库已损坏 | **停止切换**，先处理损坏 |
| 其它失败 | — | 未做任何改动，可安全重试 |

---

## 3. 物化新配置

```bash
node scripts/sync.mjs
```

期望 `no changes` 或少量变更后成功。若报错，**不要继续**，把输出发我。

---

## 4. 启动 Host

```bash
dsh
```

首次启动会构建新 launcher（几分钟，有进度输出）。等它起完。

---

## 5. 验证

```bash
node packages/dsh-pet/scripts/verify-storage-cutover.mjs
```

**期望全绿：**

```
✓ 介质被 Host 独占
  第二个 writer 无法进入,单写者保证成立
✓ dsh-storage-sqlite 为官方原版
  v0.1.5-rc.2
✓ Host runtime 身份正确
  fingerprint: 73ed72bf6eb99edf…
✓ Pet 管理面响应
  HTTP 401(需认证,属正常)

全部通过。
```

几个要点：

- **「介质被 Host 独占」是成功标志**，不是错误。它证明第二个 Host 进不来。
  切换前这一项必然是 ✗（旧 backend 没有排他锁）。
- `HTTP 401` 正常 —— 管理面需要认证，能返回 401 就说明 Pet 已加载。
- fingerprint 应为 `73ed72bf…`（新的）。若仍是 `cef535d8…`，说明没用上新
  launcher，回到第 3 步。

### 再打开 GUI 看一眼

- Pet 浮层在
- 设置 → Pet → 任务列表还在（数量与第 2 步的记录数量级相符）
- 飞书通道状态正常

---

## 6. 回滚（只在出问题时）

```bash
dsh stop
# 用第 2 步记下的那行,把备份盖回去
cp "<备份路径>" ~/.dsh/plugins/dsh-pet/state.sqlite
git revert 1bf97d30 5256ee4d
node scripts/sync.mjs
dsh
```

**顺序不能换**：先停 Host，再恢复数据，最后回滚代码。让新旧两套实现读写同一份
介质是唯一真正危险的状态。

---

## 遇到问题

任何一步的输出与预期不符：

1. **停在那里**，别往下走
2. 把命令和完整输出发我
3. 现网此刻是安全的 —— 备份已在、代码可回滚、数据未被新实现写过

---

## 这次改了什么（备查）

| | 之前 | 之后 |
|---|---|---|
| Pet 的持久化 backend | 打过补丁的官方 `storage-sqlite` | Pet 自己注册的 `pet-sqlite` |
| 被替换的上游包 | 7 个 | **1 个**（只剩 `dsh-subagent`） |
| patch 规模 | 72 hunks | **32 hunks** |
| 生成物磁盘 | 3.9 GB | **2.2 GB** |
| `journal_mode` | wal | delete |
| 单写者保证 | 由补丁提供 | 由 Pet 自己的连接提供 |

数据文件位置、域名 `dsh_pet`、表结构、版本戳 v15 **全部不变**。
