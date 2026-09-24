# 部署 overlay provenance 漂移：检测、修复与一个被真机证伪的实现

## 结论

**漂移已修复**，四个 storage overlay 的部署副本从 `0.1.2-rc.1-locus-atomic.1`（upstreamBase `a66e4702`）恢复为 `0.1.5-rc.2-locus-atomic.2`（`fb2c4b9e`）。`sync` 连续两次「no changes」，幂等成立。

## 修复前后

| 包 | 修复前 | 修复后 |
|---|---|---|
| `@deepseek-ai/dsh-storage` | `0.1.2-rc.1-locus-atomic.1` / `a66e4702` | `0.1.5-rc.2-locus-atomic.2` / `fb2c4b9e` |
| `@deepseek-ai/dsh-storage-domain` | 同上 | 同上 |
| `@deepseek-ai/dsh-storage-json` | 同上 | 同上 |
| `@deepseek-ai/dsh-storage-sqlite` | 同上 | 同上 |

源产物（`compat/subagent/storage-artifacts/`，实为指向 `.storage-artifact-builds/3951f1de…` 的 symlink）自始至终是正确的 `fb2c4b9e` 代；漂移只存在于部署副本。

## ⚠️ 第一版实现被真机证伪（必须记录）

最初的实现只是把 provenance 漂移接进既有的 `compatChanged`，然后走原有的 `dsh plugin add`。**单元测试 3/3 全绿，真机上却完全无效**：

```
[sync] local package dsh-pet deployed compatibility overrides were built from
       a different upstream base (@deepseek-ai/dsh-storage, …), reinstalling atomically
[sync] done — 2 change(s) applied
exit=0
```

诊断准确、退出码 0、**部署副本纹丝不动**。

### 根因

`compatibility` 产物是**原地重建**的：`storage-artifacts` symlink 换了指向，但 profile 里记录的依赖 spec 字符串

```
file:/…/packages/dsh-pet/compat/subagent/storage-artifacts/storage-domain
```

**按定义不会变**。pnpm 据此判定该 `file:` 依赖已满足，跳过物化，陈旧目录（`links=2`，硬链接自 9/14 那一代）原样保留。

即：**「源目录内容变了」不是 pnpm 会重新物化的理由，「spec 字符串变了」才是。** 而 compatibility 产物的整个设计就是让 spec 保持稳定。

### 为什么单测没抓到

第一版 fixture 的假 CLI 在 `add` 时无条件 `rm -rf` 后重新拷贝 —— 那是"永远会覆盖"的语义，恰好把被测缺陷抹平了。**fixture 比被测实现更宽容，测试就失去判别力。**

### 修复

1. 逐出**恰好那些漂移的** overlay 目录，再执行 add（仓库已有 `refreshLocalDeployment` 用同样的 evict-then-add 思路处理内容漂移，此处与之对齐）；
2. add 之后**复验 provenance**，仍不一致则 `fail`，不得以退出码 0 报告成功。

### fixture 同步修正

假 CLI 改为复刻 pnpm 的真实规则：`if [[ -d "$d" ]]; then continue; fi` —— 目录已存在即跳过。新增 `FAKE_ADD_NOOP` 模拟「add 成功但没物化」。

## 测试

`tests/sync-compat-provenance.test.mjs`，4 例：

| 用例 | 断言 |
|---|---|
| provenance 漂移必须重新物化 | 部署副本 upstreamBase 回到源产物 |
| 逐出后仍未修复必须 fail closed | 非零退出 + `still report a different upstream base` |
| 诊断必须点名 provenance 漂移 | 匹配 `different upstream base` 与具体包名 |
| provenance 一致不被误判 | 连续 sync 不重复安装 |

**两轮变异测试**（关掉被测逻辑，确认测试确实失败）：

| 变异 | 结果 |
|---|---|
| 移除 `compatDrifted` 参与 `compatChanged` | 4 例中 2 例失败 ✓ |
| 移除逐出循环（保留检测） | 4 例中 2 例失败 ✓（正是真机那个缺陷） |

两轮中"防误判"一例始终通过，说明测试不是靠过度断言取胜。

## 回归

- 根测试：**138 pass / 0 fail**（基线 134 + 新增 4）
- `sync` 连续两次：`no changes — deployment already matches manifest`
- Host **未重启**（按用户要求，重启时机由用户决定）；本次修复只改写磁盘部署副本，运行中的 Host 仍持有旧 overlay，直到下次重启才切换

## 对设计的印证

design D5 把该校验定为「先于批 B 落地，且独立于批 B 是否完成」。本次修复验证了这个顺序的价值：**漂移在批 B 之前就已存在于现网**，若等批 B 一起做，这段时间内 Host 会持续加载与 launcher 不同代的 storage 实现。
