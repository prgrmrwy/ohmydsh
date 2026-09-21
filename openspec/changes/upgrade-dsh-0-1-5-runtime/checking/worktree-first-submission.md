# 5.4 Worktree Session 首发验收(devbox,一次性 fixture 仓库)

按 9.6 的要求用**一次性 fixture 仓库**,不拿候选 checkout 当被测仓库:

```
/tmp/wt-fixture/repo      git init, 分支 main, 提交 8463e19(含 package.json + package-lock.json)
/tmp/wt-fixture/note.txt  文本附件(38B)
/tmp/wt-fixture/pixel.png 16x16 PNG(图片附件)
```

用浏览器驱动把它加成 DSH 工作区(添加工作区 → 编辑路径 → 输路径 → 回车 → **打开**),
然后在其中开 Worktree 会话、挂附件、提交一次。

## 通过项 ✅

### 失败前置条件(fail closed,且给出可读原因)

第一次提交被拦下,原因合法且明确:

```
项目根目录缺少 package-lock.json 或 pnpm-lock.yaml:
Worktree Session 目前仅支持 npm / pnpm 项目(未支持的包管理器如 yarn、bun、rush 暂不支持)
```

**未创建会话、未创建 worktree**(事后核对:worktree 列表仍 1 条、会话目录不存在)——
即拒绝发生在任何副作用之前,这是正确的 fail-closed 行为,不是缺陷。
给 fixture 补上 npm lockfile 后即通过。

### 首发成功(补 lockfile 后)

| 观测 | 值 |
|---|---|
| Worktree 开关 | `aria-pressed` **false → true**(`☑ Worktree`) |
| 基准 ref | `⑂ main` |
| 会话标题 | 自动生成;id 徽标 `f87511` 与 `session-f87511f4-…` 前缀一致(session-title-id-badge 插件同时得到验证) |
| 附件 | `note.txt TXT 38B` 随消息送达 |
| 助手响应 | `已思考` → `收到` |
| 轮次/步数 | **`1 轮 1 步`** → 单次提交,无重复 turn / 无重复消息 |
| worktree 模式 | **`lean · npm`**,状态 `active` |
| console | **0 错误** |

### git 侧硬证据(单个 worktree、单个分支)

```
$ git -C /tmp/wt-fixture/repo worktree list
/tmp/wt-fixture/repo                             8463e19 [main]
/tmp/wt-fixture/repo/.worktrees/task-05d1e1a143  8463e19 [ws/task-05d1e1a143]
worktree 总数: 2          ← 主 repo + 恰好一个任务 worktree
$ git branch
* main
+ ws/task-05d1e1a143      ← 恰好一个新分支
```

会话日志为 `session.v3.jsonl.zstd`(新格式),且**该工作区下只有这一个会话目录**。

### 附件字节确实走官方通道(本次改动的核心)

这是 5.4 最想证明的一点 —— handoff 已从"私有两段上传协议"改为**官方单次 `submit`**。
证据是附件字节落进了官方附件存储,而不只是个名字 chip:

```
~/.dsh/attachments/v1/files/2b/2bbef9c8…/note.txt        ← 内容命中 "hello worktree attachment"
~/.dsh/attachments/v1/file-objects/2b/2bbef9c8…
```

worktree 内还被自动备好 `.env.local` 与 `node_modules`(`lean · npm` 模式的行为)。

## 未验证(明确记录,不写成通过)

- **图片附件(PNG)**:首轮一次挂两个文件时只挂上了文本(`note.txt`),图片未出现在输入区;
  单独重测 PNG 的那次脚本挂在浏览器启动阶段未完成(远端进程未随本地 job 取消、
  其 stdout 管道已断,故输出丢失——属测试脚手架问题,不是产品结论)。
- **普通模式(不开 Worktree)提交**:与上一条同一次脚本,未完成。
- 任务原文里的 **"resource address 不借当前 tab Session"** 与
  **"cold Session 从 persistence header 定位且不激活 Agent"** 两个子项未触达。

## 脚手架

fixture 仓库保留在 devbox `/tmp/wt-fixture/`(一次性,可在收尾时删除);
它已作为工作区 `repo` 注册进 devbox 的 DSH,**host/lumevm 上不存在**,不影响交接。
