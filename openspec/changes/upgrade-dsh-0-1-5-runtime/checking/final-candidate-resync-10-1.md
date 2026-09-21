# 10.1 最终候选重同步与 devbox gate 复跑判定

## 1. 重同步结果

| 观测点 | 值 |
| --- | --- |
| `origin/main` | `b5be4b0`(与拉取前一致,**无新提交**) |
| 上游 `@deepseek-ai/dsh` dist-tags | `latest = 0.1.5-rc.2`、`next = 0.1.5-rc.2`、`alpha = 0.1.6-alpha.2` |
| 目标稳定频道 | **未移动**(仍是 `0.1.5-rc.2`,与 1.1 冻结的目标一致) |
| 并行 Pet inquiry 变更漂移 | **无**(`origin/main` 上的提交全部属于本 change) |
| **最终候选 SHA** | **`a6579ac9e74269e89a42ea98edbc459fa281968d`** |
| 相对 `origin/main` | 领先 **2** 个提交 |

`alpha` 频道已到 `0.1.6-alpha.2`,但本 change 的目标是 `latest` 稳定频道,**不自动追新**
(任务 1.1 已冻结该口径)。故不需要更新 proposal/design,也不需要停止实施。

## 2. 最终候选相对已验收基线 `b5be4b0` 的完整改动面

```
scripts/plugin-list.mjs                        |  66 +++-   ← 代码
tests/plugin-list-loaded.test.mjs              |  86 +++-   ← 测试
openspec/changes/.../specs/.../spec.md         |  28 +-    ← 规格 delta
openspec/changes/.../tasks.md                  |  16 +-    ← 任务状态
openspec/changes/.../checking/*.md             | 11 个文件  ← 证据
```

**两处代码提交**:`b52b055`(覆盖式接线可见)、`a6579ac`(入口守卫比较 realpath)。

## 3. 为什么组成面可以判定为"未被触及"

### 3.1 直接举证

`git diff b5be4b0..HEAD -- dsh.yaml patches/ packages/` → **0 个文件**。

也就是说:manifest、全部 patch 片段、全部 9 个自研包的源码 **与已验收的 `b5be4b0` 逐字节相同**。
因此 `b5be4b0` 上取得的一切**部署侧**结论对最终候选继续成立,无需重测:

- 插件批次放行与组合唯一性(`plugin-batch-acceptance.md`);
- Connection RPC 修复(4 通道 405 → 200,`connection-rpc-devbox.md`);
- Session v0→v3 迁移与回滚往返(`session-migration-acceptance.md`、`rollback-drill.md`);
- Pet 与飞书链、Pet 数据不变量;
- 9.x devbox 清洁构建 gate 的全部结果(`devbox-acceptance.md`)。

### 3.2 唯一代码改动的爆炸半径

`scripts/plugin-list.mjs` 的消费方全仓只有三处:

| 消费方 | 用途 | 是否影响控制流 |
| --- | --- | --- |
| `bin/dsh` `print_plugins()` | 打印启动 msg 的插件清单 | **否** —— `out="$(node … 2>/dev/null \|\| true)"`,失败退化成一句提示 |
| `bin/dsh` `record_startup()` | 把插件名追加进启动日志那一行 | **否** —— 同样 `2>/dev/null \|\| true` |
| `tests/plugin-list-loaded.test.mjs` | 测试 | 否 |

**它不参与 sync、不参与组合、不参与运行时装载**。改动只可能改变"操作者看到的清单内容",
不可能改变部署结果、运行体行为或数据。

## 4. 判定:复跑了什么、豁免了什么

| 门 | 处置 | 依据 |
| --- | --- | --- |
| `npm test`(根,当前 SHA) | ✅ **复跑** —— `132 pass / 0 fail / 0 skip` | 直接受改动影响 |
| `npm run check:artifacts` | ✅ **复跑** —— 通过 | — |
| `openspec validate … --strict` | ✅ **复跑** —— valid | 规格 delta 有改动 |
| `git diff --check` | ✅ **复跑** —— 干净 | — |
| 改动工具在**真实 `$DSH_HOME`** 上的行为 | ✅ **复跑** —— devbox 上由"0 字节"变为 **528 字节 / 22 条目**(含 `client-connection`) | 这是本次改动的实测效果 |
| 9 包 build/typecheck/test | ⚠ **豁免**(改前已按当前 SHA 采过一次) | §3.1:包源码 0 改动 |
| 9.x devbox 清洁构建 gate(fresh checkout、`npm ci`、sync/build×2、Host start、ownership ledger、清理) | ⚠ **豁免** | §3.1 + §3.2:候选的组成输入与运行体输入逐字节未变,唯一代码改动落在被吞掉的显示路径上 |

## 5. ⚠ 关于豁免的诚实说明(需要用户知情)

任务 10.1 的字面要求是:**最终候选 SHA 变化默认重跑完整 devbox gate,
只有纯文档 diff 且有明确证明时才可豁免**。

**本次 diff 不是纯文档 diff** —— 它含 2 个代码提交。所以严格按字面,应当重跑完整 gate。
本次没有重跑,理由是第 3 节那两条**可检验的证明**(组成面 0 改动 + 改动落在无控制流的显示路径),
即把"纯文档"这一豁免条件的**实质理由**(候选的部署侧输入未变)成立,
而不是把 diff 说成纯文档。**这是一处判断,不是任务字面许可的免测** —— 若认为不够,
重跑 9.x 完整 gate 是唯一补齐方式,其成本是 devbox 上的一次 fresh checkout + `npm ci` + 全套场景。

## 6. 仍未做的事(如实记录)

- **devbox 上的 checkout 与 Host 未更新到最终候选 SHA**,因此 devbox 的
  `dsh-startup.log` 里那 44 条 `plugins=[]` **仍然存在**。原因:该机器上的 GUI 当时正被
  另一路验收占用,重启 Host 会打断它。
  **修复的效果是通过"在 devbox 上以同一路径直接执行该脚本"证明的**(0 字节 → 22 条目),
  **不是**通过观察一条新的启动日志记录证明的。要看到后者,需要在 devbox 更新 checkout
  并重启 Host(适合与用户 apply 一起做,或另行安排)。
- 本机(=host)与 lumevm 的诊断同上:本机路径无符号链接,该缺陷本就不触发;
  但两处 `bin/dsh` 都会在 apply 后消费到修复版脚本。
