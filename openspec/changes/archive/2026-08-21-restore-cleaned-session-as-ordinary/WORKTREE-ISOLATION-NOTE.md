# 临时记录：Worktree Session 的 DSH_HOME 隔离边界

记录时间：2026-08-21

## 本次现象

从 Worktree Session 的任务 worktree 直接执行：

```bash
DSH_SKIP_UPDATE=1 <worktree>/bin/dsh restart
```

该 launcher 会 source worktree 自己的 `.env.local`。Worktree Session 在该文件中写入了：

```bash
DSH_HOME='<git-common-dir>/ws/dsh-home/<operationId>'
```

因此被启动的 Host 使用任务专属、初始为空的 DSH_HOME，而不是用户日常 GUI 的 `~/.dsh`。可观察结果包括：

- 只加载该隔离 home 已安装的基础 bundle；
- 看不到 `~/.dsh` 中的自定义插件、Workspace/Session、provider 配置与凭据；
- UI 会像全新安装一样要求配置 API Key；
- 原 `~/.dsh` 数据没有丢失，只是该进程没有读取它。

## 设计结论

当前“完全隔离”本身符合既有设计，但仅适用于 **worktree 内的 ohmydsh 开发构建/隔离验收**：

- Git worktree/branch：任务源码隔离；
- `node_modules`：lean cache 复用或 promote 后本地可变；
- `.env.local`：从 ignored 源复制，保留本地设置；
- task `DSH_HOME`：隔离 build/sync/deployment 产物，防止未验收代码写入真实 `~/.dsh`；
- 当前日常 GUI Host：仍应使用其启动时的真实 `~/.dsh`。

不符合预期的是把 task launcher 当作日常 Host 的重启入口。现有 UX 容易误用，因为同一个 `bin/dsh` 同时承担 build 与 start/restart，而 `DSH_HOME` 是进程级总根目录，不只是“构建输出目录”。

## 隔离度分层建议

1. **源码隔离（默认任务执行）**：独立 branch/worktree；Agent 本地工具只访问 managed root。
2. **依赖隔离（默认 lean）**：同 fingerprint 共享只读式 cache；依赖变更前 promote 为 worktree-local mutable。
3. **部署隔离（默认开发 build）**：task `DSH_HOME`；用于 `dsh build`、插件组合检查、独立测试 Host，不读取真实配置。
4. **真实配置验收（显式 opt-in）**：保留 `DSH_HOME=$HOME/.dsh`，只部署/加载候选 bundle；这是会影响日常环境的操作，必须显式执行并可回滚。
5. **生产/日常使用**：实现合入 main 后，由 main launcher 对真实 `~/.dsh` build/restart；不再依赖 task worktree 路径。

## 后续改进候选

- 将 build 输出根与运行数据根拆开，例如 `DSH_BUILD_HOME` / `DSH_RUNTIME_HOME`，避免一个变量同时隔离 bundle、Workspace、Session、凭据和日志。
- task `.env.local` 不直接覆盖 `DSH_HOME`，改由 `bin/dsh build` 在 Worktree Session 中选择隔离 home；`start/restart` 检测到 managed task home 时明确拒绝或二次确认。
- 新增显式命令：
  - `dsh build --isolated`：写 task home；
  - `dsh preview --isolated --port <port>`：启动空白隔离验收实例；
  - `dsh deploy --profile web`：显式写真实 `~/.dsh`；
  - `dsh restart`：只重启既有真实 profile，不隐式换 home。
- launcher 启动时打印绝对 `DSH_HOME` 和 profile 路径；当 home 位于 `.git/ws/dsh-home/` 时显示醒目的“隔离预览环境”提示。
- 验收文档必须区分“isolated preview acceptance”和“real profile acceptance”，不得再把 task launcher 当成真实 GUI 的无副作用重启方式。

## 与当前 change 的关系

该问题不是 `cleaned → released` 生命周期实现本身的功能缺陷，但它直接影响 5.4 的真实 Host 验收方法。在解决/明确部署步骤前，不应把 5.4 标记完成。
