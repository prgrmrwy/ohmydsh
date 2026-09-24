# 8.2 最终组合回归与 0.1.2 基线逐项比对

## 结论先行

| 子项 | 判定 |
| --- | --- |
| 根自动化 | **通过** —— `132 pass / 0 fail / 0 skip`(0.1.2 时是 `127 pass / 1 skip`) |
| 9 包自动化 | **通过** —— 9/9 全绿,且**每一处 0.1.2 时的失败都已消失** |
| 真实旧 Session 迁移/重启 | **通过** —— 见 `session-migration-acceptance.md` |
| Worktree 文本首发 | **通过** —— 见 `worktree-first-submission.md` |
| Worktree 图片/文件/混合载荷首发 | 见 `worktree-attachment-paths.md` |
| 用户可见基线逐项比对 | **部分** —— 0.1.2 侧的 GUI 值**从未被测量**,只有场景清单,故无法做数值级逐项比对(见 §4) |

---

## 1. 根自动化:两版对照

| 观测点 | 0.1.2-rc.1 基线 | 当前(0.1.5-rc.2) |
| --- | --- | --- |
| `npm test` | 127 pass / **1 skip** / 0 fail(共 128) | **132 pass / 0 fail / 0 skip** |
| `npm run check:artifacts` | passed | passed |
| Node / npm | v24.20.0 / 11.19.0 | v24.20.0 / 11.19.0(同版本,可比) |

差额来源已核对清楚,不是"凭空多出来 5 个":

- `+3` = 本次新增的 plugin-list **覆盖式接线**测试(`plugin-list-override-blindspot.md`);
- `+1` = 本次新增的 plugin-list **入口守卫(符号链接)**测试,以**子进程 + 符号链接路径**运行
  (`plugin-list-entry-guard-symlink.md`);
- `+1` = 原本 **skip** 的那一例(`every manifest patch fragment this repo ships stays parseable`)
  现在**真正执行并通过** —— 它在 `patches/` 为空时跳过,新 fragment 一加入就走到了检查面。

> 也就是说:0.1.2 的 `1 skip` 并非"稳定跳过",而是一个**条件跳过**。它的条件变了,
> 它就从 skip 变成一条真实断言 —— 这次也正是它把读取器的覆盖式接线盲区暴露出来的。

## 2. 9 包自动化:逐项比对

命令:`npm run build && npm run typecheck && npm test`(shim 只有 Node test 命令)。
当前列在候选 SHA 上以 **Node v24.20.0**(与本机 DSH 运行体同版本)实测。

| 包 | 0.1.2 build | 0.1.2 typecheck | 0.1.2 test | 当前 build | 当前 typecheck | 当前 test |
| --- | --- | --- | --- | --- | --- | --- |
| `dsh-memex` | pass | pass | 174 pass | **pass** | **pass** | **174 pass / 0 fail** |
| `dsh-pet` | pass | **FAIL** | **4 套件 6 例失败** | **pass** | **pass** | **2 687 pass / 0 fail / 43 skip** |
| `home-network-model-guard` | pass | pass | 70 pass | **pass** | **pass** | **70 pass / 0 fail** |
| `session-links` | pass | pass | 54 pass | **pass** | **pass** | **54 pass / 0 fail** |
| `session-title-copy` | pass | pass | 20 pass | **pass** | **pass** | **20 pass / 0 fail** |
| `sidebar-session-provider-icon` | pass | pass | 25 pass | **pass** | **pass** | **25 pass / 0 fail** |
| `subscriptions-sandbox-shim` | n/a | n/a | 26 pass | **n/a** | **n/a** | **26 pass / 0 fail** |
| `system-clock` | pass | pass | 21 pass | **pass** | **pass** | **21 pass / 0 fail** |
| `worktree-session` | **FAIL** | **FAIL** | 201 pass | **pass** | **pass** | **206 pass / 0 fail** |

### 关键读法

1. **0.1.2 侧的失败全部消失**。`dsh-pet` 的 typecheck 失败与 4 套件 6 例失败,
   根因是旧依赖树缺 `dsh-client-ui-layout/client`、`dsh-api-workspace-controller/client`、
   `dsh-storage-sqlite`,以及 DSW token 声明集不全;`worktree-session` 的
   build/typecheck 失败是解析不到 `@deepseek-ai/dsh-user-questions`。
   基线报告当时就写明:**这些不得被当作"迁移已兼容"的证据**,必须在目标依赖树合成后复跑。
   现在复跑了,**全部转绿** —— 即它们确实是旧依赖树的环境缺口,不是迁移缺陷。
2. **无一项退化**。所有 0.1.2 时已通过的包,当前用例数**相等或增加**
   (`worktree-session` 201 → 206,`dsh-pet` 6 例失败 → 0)。
3. **`subscriptions-sandbox-shim` 的 `n/a` 是事实,不是跳过**:该包
   `package.json` 只有 `{"test": "node --test test/*.test.mjs"}`,没有 `build`/`typecheck` 脚本,
   执行 `npm run build` 会得到 `npm error Missing script: "build"`。两个版本一致。
4. **Node 版本会影响结论,必须写明**。本机有两个 Node:`~/.nvm/.../v22.23.2` 与
   fnm 的 `v24.20.0`。`@touchskyer` memex kernel 只全局装在 **Node 24.12 / 24.20** 下,
   用 v22.23.2 跑 `dsh-memex` 会失败并报
   `ENOENT: … lstat '<nvm v22.23.2>/lib/node_modules/@touchskyer'` ——
   这是**环境缺口,不是回归**。上表统一用 v24.20.0(与本机 DSH 运行体一致)采集。

## 3. 真实旧 Session 迁移 / 重启 与 Worktree 首发

- **Session 迁移/重启**:通过,见 `session-migration-acceptance.md`。
  真实旧 Session 备份副本上触发官方 v0→v1→v2→v3,旧 generation 保留、新 generation 原子发布;
  迁移后继续提交 + 停止 + 重启,恢复写入一致,原始生产源未被候选打开或改写。
- **Worktree 文本首发**:通过,见 `worktree-first-submission.md`。
  **fragment 之外的细节**:新 fragment 一加入,`patches/` 就不再为空,
  原本 skip 的 plugin-list 测试转为执行 —— 这条链路本身也是本次回归的一部分(见 §1)。
- **Worktree 图片/文件/混合载荷**:另见 `worktree-attachment-paths.md`。

## 4. 用户可见基线逐项比对:**只有场景清单,没有 0.1.2 侧的实测值**

这一条**没能做到任务原文要求的"逐项比对"**,原因在基线本身,如实记录:

- 0.1.2 侧留下的是 `old-runtime-blackbox.md`,它明确写着:
  「Manual/GUI scenarios not covered by this run are Worktree first-send, Session cold resume,
  Memex UI, guard UI, clock UI, session-links/title/provider-icon UI, Cockpit, remote Web
  features, and Feishu entry/media flows. **Those remain required target-runtime/devbox scenarios.**」
  —— 即它是一份**待跑清单**,不是一份**测得的基线**。
- `baseline-0-1-2.md` 同时明确说:"This report keeps summarized outcomes only",
  其覆盖范围是根检查与 9 包自动化,**不含 GUI**。

因此严格意义上的"与 0.1.2 记录逐项比对"在这些 GUI 项上**不可构造** ——
没有 0.1.2 侧的数值可对。能做的、也是实际做的,是把 0.1.5 侧的实测值逐项固定下来,
使其**成为**今后可比的基线:

| 用户可见面 | 0.1.2 侧记录 | 0.1.5 侧实测 | 出处 |
| --- | --- | --- | --- |
| 插件批次启动清单 / 组合唯一性 | 场景清单 | loader 172 条、**重复 id 0**、每定制恰好 1 条 | `plugin-batch-acceptance.md` §3 |
| 客户端模块图(= 用户可见激活) | 场景清单 | 16 个定制逐一确认已下发 | `plugin-batch-acceptance.md` §4 |
| 浏览器级 GUI(标题/节点数/异常/设置页全集) | 场景清单 | `DeepSeek Harness`、658 节点、**0 未捕获异常**、设置页 13 个 section | `plugin-batch-acceptance.md` §5 |
| better-sidebar / width-tiers / cost-meter | 场景清单 | 逐项实测值(含 `余额 ¥291.71`、`--dsh-chat-content-width` 已接线) | 同上 |
| session-links / title / provider icon / clock / guard | 场景清单 | 见 `connection-rpc-devbox.md` 修复后的四通道 200 | 同上 + `connection-rpc-devbox.md` |
| Pet / 飞书链 | 场景清单 | `🐾` 宿主在 `document.body`、`ready` + `subscription connected` | `plugin-batch-acceptance.md` §5 |
| Cockpit | 场景清单 | 见 `gui-residual-0-1-5.md` | — |

> **可复核的诚实说明**:上表右列全部是**本轮新测得**的值,左列没有对应数值。
> 所以这张表**不能**用来声称"升级前后一致";它能证明的是"升级后这些面各自是什么状态",
> 以及"0.1.2 侧从未固定过可比基线"这一事实本身。

## 仍未覆盖

- **0.1.2 侧 GUI 基线从未建立** —— 本次只能补测 0.1.5 侧。这是本 change 的
  基线设计缺口(任务 1.5 要求固定旧版人工/黑盒基线,实际只固定了清单)。
  若要真正可比的 GUI 回归,需要在某一版上先测得基线再升级。
- `dsh-pet` 的 **43 个 skip** 未逐条核对其跳过原因;只确认了 0 fail。
- 本机(=host)与 lumevm **未参与**本轮验收,其部署状态不得被写成已验收(任务 10.4)。
