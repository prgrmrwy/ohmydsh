# 批 B 实施：storage 自持（注册自有 backend）

## 结论

**`storage-atomic.patch` 已删除。compat 的上游包从 3 个降到 1 个，仅剩 `subagent/subagent`。**

`dsh-storage` / `dsh-storage-domain` / `dsh-storage-json` 在 launcher 中已回到**官方原版 `0.1.5-rc.3`**；profile 中的 `dsh-storage-sqlite` 回到**官方 `0.1.5-rc.2`**。

## 路径修正：从"改上游"到"注册 backend"

初版实现保留官方 backend、在旁边另开一个连接专门持锁，**真机验证失败**：SQLite 的排他锁是**按连接**持有的，两个连接互斥，任何需要双句柄的路径直接死锁（Pet 测试从 88 秒变成超时）。

随后核实发现 `@deepseek-ai/dsh-storage` **公开导出了完整的 backend 契约**：

```ts
export interface StorageBackend { readonly kv?: KvFacet; close(): Promise<void> }
export interface KvFacet { open(descriptor: KvUnitDescriptor): Promise<KvUnit> }
class BackendRegistry { register(name: string, backend: StorageBackend): () => void }
```

且官方文档明述路由归消费者：

> Multiple backends stay mounted side by side; **which backend serves which consumer is the consumer's configuration**, never a hub-global choice.

社区 RFC #3937 亦称 `ctx.storage` 为 "clean plugin slots"。因此 Pet 实现自己的 `StorageBackend`，上游零改动。

## 实现

| 文件 | 职责 |
|---|---|
| `src/host/storage/backend.ts` | Pet 的 `StorageBackend`：一个独占 SQLite 连接、`applyBatch` 原子批、unit 版本戳 |
| `src/host/storage/atomic-domain.ts` | 给官方 `Domain` 补 `transaction()`，经**同一个 unit** 提交，提交后刷新内存视图 |
| `src/host/storage/plugin.ts` | 独立 Cordis 行 `dsh-pet-storage` |

### 为什么 backend 必须是独立的一行

`storage-domain` 为每个路由 backend 注入 `storageBackendServiceKey(name)`；而 `dsh-pet` 行注入 `storageDomain`。若由 Pet 行自己 provide 该服务，依赖图成环，两者都永不加载。独立行使顺序无环：

```
dsh-pet-storage → 提供 backend service
      ↓
storage-domain  → 路由 dsh_pet
      ↓
dsh-pet         → 注入 storageDomain，开 domain
```

### 保留未动

四个 store 类的 `supportsTransaction` fail-closed 分支**原样保留**。缺 unit 时该分支拒绝写入，是正确的失败姿态。

## 变异测试抓到一个真 bug

去掉 `openMedium` 中强制获取锁的 `BEGIN IMMEDIATE`/`COMMIT` 后，测试**仍然全绿**。

根因：`PRAGMA locking_mode = EXCLUSIVE` 是**惰性**的，SQLite 直到下次写入才真正取锁。新建库时 schema bootstrap 恰好写了一次，顺带把锁拿到了——于是"新建库"这个用例**无法检测该缺陷**。而对**已存在的库**，所有 `CREATE TABLE IF NOT EXISTS` 都是空操作，什么都不写，第二个 Host 会长驱直入并开始处理同一份持久化工作。

已补针对"已存在库"的用例，变异后该例失败。

**三轮变异全部被捕获**：

| 变异 | 结果 |
|---|---|
| 删除 `applyBatch` 的 ROLLBACK | 2 例失败 ✓ |
| 强制取锁改为惰性 | 1 例失败 ✓ |
| 删除提交前的表名预检 | 1 例失败 ✓ |

## 测试脚手架的既有缺陷（本批顺带暴露）

四个测试文件直接组合 compat 产物并路由到 `'sqlite'`。改接 Pet backend 后发现多处 `close()` **只关 domain、不释放 backend**——此前因为没有真正的独占锁而无症状：

| 文件 | 修正 | 耗时变化 |
|---|---|---|
| `collaboration-assembly` | `afterEach` 真正 dispose；重启用例先关 Host 再读盘 | 61s → **2.7s** |
| `loader-composition` | 11 处默认 backend 改桩；路由断言改用常量 | 380s → **7.8s** |
| `sqlite-composition` | `afterEach` 补 dispose；重启用例补 `fiber.dispose()` | — |
| `acceptance` | `close()` 同时 dispose context | — |

另：`collaboration-assembly` 原本在产物缺失时整段 `skipIf` 跳过，现已无构建前置，改为始终运行。

## sync 的 compatDependencies 退役路径

删除 manifest 条目后 sync 报错：

```
refusing to remove or rename active compatibility overrides (…); disable the owner and sync first
```

守卫本身正确——它防的是"丢掉一部分 override、留着另一部分"，那会让 owner 跑在半替换的依赖树上。但**退役最后一个**性质不同：owner 已完全不再请求 override，恢复官方包正是目的本身，不存在混合树。若不区分，`compatDependencies` 机制将永远无法下线。

已按此区分实现，并在同一次 pnpm 事务内移除 override 包。新增测试钉住该路径与其后的幂等性。

## launcher 的框架版本必须显式声明

移除 storage overrides 后 launcher 构建失败：

```
npm error extraneous: @deepseek-ai/cordis-plugin-include@1.0.9
npm error invalid:    @deepseek-ai/cordis@4.0.4
```

查明：官方包对 cordis 的声明是**混合**的——`dsh-app-boot`、`dsh-agent-presets`、`dsh-session` 声明**精确** `4.0.2`，而 `dsh`、`dsh-storage` 声明范围 `^4.0.2`。npm 可能先用最新版满足范围、再撞上精确要求，于是树被判 `invalid`。

**此前之所以能装对，只是 storage `file:` overrides 被先展开的副作用——一个偶然，不是约束。** 也就是说这个脆弱性一直存在，只是被掩盖着。

修法：在 launcher manifest 显式声明这两个框架版本，值**从 reviewed 上游树读取**（`upstreamVersions()` 已 walk `vendor/`），不硬编码——与 patch hash "derived, never pasted" 同一原则，上游 tag 变化时自动跟随。

## 验证

| 项 | 结果 |
|---|---|
| launcher 重建 | 成功，fingerprint `19759157…` |
| launcher 覆盖面 | **仅 `dsh-subagent`**；storage 三件套与 agent 对均为官方原版 |
| cordis / cordis-plugin-include | `4.0.2` / `1.0.7`（reviewed 版本） |
| profile compatDependencies | **已退役**，`dsh-storage-sqlite` 回到官方 `0.1.5-rc.2` |
| `sync` 连续两次 | `no changes — deployment already matches manifest` |
| 根测试 | **141 pass / 0 fail**（基线 134） |
| Pet 测试 | **2734 passed / 43 skipped**（基线 2696 / 43） |
| Pet build / typecheck | 通过 |

## 遗留（停机窗口执行）

Host **未重启**。运行中的进程仍持有旧 launcher 与旧 storage overlay，重启后才切换。因 Pet 的介质由运行中 Host 独占持有，备份与切换必须在停机窗口进行（tasks 6.6 / 6.7）。
