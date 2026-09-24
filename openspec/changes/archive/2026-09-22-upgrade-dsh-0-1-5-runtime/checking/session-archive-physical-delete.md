# 7.4 会话归档「物理删除」补测(devbox 实测)

## 结论先行

同批 GUI 验收(`gui-residual-0-1-5.md` §B)里,**物理删除**因所有会话都被判 `attached`
而未能达成,当时记为**未通过(不可达成)**,并推测"只能靠重启 Host 释放"。

本次重启 Host 后复测:

| 子项 | 结果 |
| --- | --- |
| 物理删除是否**可达** | ✅ **可达**且**真的落盘** |
| `attached` 守卫是否**永久**阻止一切删除 | ❌ **不是** —— 它是**逐会话**的真实保护 |
| "重启即释放全部" | ⚠ **不准确** —— 重启后其中**一个**仍被重新挂上 |

---

## 实测

### 现场(重启 Host 之后)

`GET /api/dsh-session-archive/inventory`:HTTP 200,`rows` = **53**,`archivedSessionIds` = **12**。

被测对象是 GUI 验收自建的两个一次性会话(结束态均为「已归档」):

| id | archived | running | sizeBytes |
| --- | --- | --- | --- |
| `session-017b68a5-7b2d-47df-bcbd-5a08795c2be8` | true | false | 30 809 |
| `session-e6bcb6b5-91e5-4f2c-8acf-336b1ae863be` | true | false | 30 489 |

调用:`POST /api/dsh-session-archive/delete`,body `{ids:[...], expectedTotal:53}`
(`expectedTotal` 是 compare-and-delete 守卫;用 `/inventory` 的 `rows.length` 填入)。

### 结果

```json
{"results":[
  {"id":"session-017b68a5-…","status":"skipped","reason":"attached"},
  {"id":"session-e6bcb6b5-…","status":"ok"}],
 "freedBytes":30489}
```

| 观测 | 删除前 | 删除后 |
| --- | --- | --- |
| `session-e6bcb6b5` 磁盘目录 | 存在 | **已不存在** ✅ |
| `freedBytes` | — | **30 489**(与其 `sizeBytes` 完全吻合) |
| `inventory.rows` | 53 | **52** |
| `inventory.archivedSessionIds` | 12 | **11** |
| `session-017b68a5` 磁盘目录 | 存在 | 仍存在 |

**即:物理删除确实执行了真实落盘删除** —— 释放字节数与目录消失、面板计数递减三者一致,
不是"标记为已删除"。

### 关于剩下的那个 `attached`

杀掉全部 CDP 浏览器客户端(`chrome-headless-shell` 归零、无自愈)后**再次**调用,
`session-017b68a5` 仍然返回 `{"status":"skipped","reason":"attached"}`、`freedBytes:0`。

所以:

- **不是**客户端连接导致的(客户端全断后依旧);
- **也不是**"重启就全释放"(该会话在重启后**被重新挂上**);
- 与源码读法一致:`janitor.ts` 的 `liveSessionIds()` 把 **Host 进程 sessions store 里**的
  会话标为 `attached`,而 `dsh-session` 只在 enter/detach 成对时移除 ——
  一个被 Host 加载过的会话会留在 store 里,重新挂载后再次计入。

**运维含义**:归档插件的物理删除**可用**,但"哪些会话当前删得掉"取决于 **Host 进程自己**
持有哪些会话,不能靠"关掉浏览器"或"重启一次"来保证清理干净。
若要清掉某个特定会话,需要在 Host **尚未加载它**的那次生命周期里删。

### 删除的"计划面"仍然正确

同批 GUI 验收已确认计划面(选中 1 / 级联 0 / 释放 29.8 KB / 不可恢复提示)无误,
本次落盘结果与计划一致(`freedBytes` = 30 489 ≈ 29.8 KB)。

---

## 对 7.4 判定的影响

| 7.4 子项 | 判定 |
| --- | --- |
| Node 约束 | ✅ |
| 主题/壁纸切换与恢复 | ✅(`gui-residual-0-1-5.md` §A;壁纸面因本机无 Wallpaper Engine 未验) |
| 旧 Session 归档 | ✅ |
| 旧 Session 预览 | ✅ |
| 旧 Session 恢复 | ✅ |
| **物理删除** | ✅ **本次补测通过**(可达且真实落盘) |
| 迁移后一致性 | ✅(10 条历史归档会话可列出,旧会话 `session-f87511f4` 在 GUI 正常打开渲染) |

## 遗留与未验证

- `session-017b68a5` **未能删除**(Host 持有),磁盘上仍在。它是一次性会话,
  不影响任何既有数据;留给后续清理。
- 未验证"在 Host 未加载该会话的生命周期里删除"这一路径(需要控制 Host 何时加载它)。
- 未测多会话批量删除与 `family-protected`(级联家族)保护的实际拒绝行为 ——
  本批被测对象都没有子会话,故级联恒为 0。
- `expectedTotal` 不匹配时的拒绝行为未测(未构造并发漂移)。
