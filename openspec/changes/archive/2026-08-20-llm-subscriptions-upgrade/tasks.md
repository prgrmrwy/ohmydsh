## 1. Manifest 升级

- [x] 1.1 `dsh.yaml`:`llm-subscriptions` 条目 `spec`/`version` 由 `dsh-plugin-subscriptions@0.3.1` / `0.3.1` 改为 `@0.4.2` / `0.4.2`
- [x] 1.2 重写 `llm-subscriptions` 的 `note`:0.4.2 语义(claude 本机凭据导入 + live 目录 + 固定回调 OAuth)、peer `^rc.5` 兼容 rc.7 运行体、信任面变化(`execFileSync` 探测 `claude --version` + keychain 读写,原"无 child_process"笔记作废)
- [x] 1.3 核对与保留:codex/grok 路由 id 不变、`subscriptions-sandbox-shim` 条目与配置(`providers: [codex, grok]`)不动
- [x] 1.4 运行 `node scripts/sync.mjs`(或 `dsh build`)物化,校验:profile 安装到 `dsh-plugin-subscriptions@0.4.2`、无悬空依赖

## 2. 重启与加载确认

- [x] 2.1 重启 `dsh web`(或指令用户重启),写入手工重启提示
- [x] 2.2 启动日志确认 `dsh-plugin-subscriptions` 以 0.4.2 加载(plugins 清单;2026-08-20 04:12 新进程 PID 7235)
- [x] 2.3 确认 `auth.json`(codex 会话,有效期至 08-29)与 `models.json` 未被升级改写

## 3. Codex 回归(可探测)

- [x] 3.1 打开 `/model`,确认 ChatGPT (Codex) 组及 live 模型正常出现(用户已切换 GPT-5.6-Sol;llm-probe 解析含完整 effort 档)
- [x] 3.2 用 codex 模型发一条消息,验证流式 + 工具调用 + 用量卡片(用户目视确认正常)
- [x] 3.3 对照 `~/.dsh/dsh.log` 的 llm-probe/request 记录,确认无新 `AUTH`/`TRANSPORT` 错误
- [x] 3.4 确认 shim 仍对 codex/grok 生效:运行时 JS 明确存在内部 `registration(provider)` 且首次 register/replace 会发 `llm/adapters-updated`;74 份历史会话严格统计显示 shim 前 Sol 322 次工具调用有 133 次顶层升级字段,shim 后 Sol 1,685 次为 0 次;所谓后续 strict-wider 命中均为 read/grep 读取该字样的文本假阳性,无真实失败。注意 `.d.ts` 未声明内部 `registration()`、日志无可选 info 行均不能作为失效证据。

## 4. Claude 登录与选择器验证(已于 2026-08-20 提前完成)

- [x] 4.1 设置 → 订阅点 Claude「登录」,断言「秒导入」本机会话(不弹浏览器),`auth.json` 出现 claude 条目(2026-08-20 当前 GUI 同源 `/subscriptions-auth/login` 返回空 `authorizeUrl`,状态立即 `loggedIn:true`;auth store 为 claude+codex,0600)
- [x] 4.2 核对 0.4.2 读取的 keychain 服务名 `"Claude Code-credentials"` 与本机 claude 2.1.221 实际条目一致;若不一致,记录并评估上游 issue(2026-08-20 实机核对一致:`security find-generic-password -s` 命中,未读取/记录 secret)
- [x] 4.3 claude 已登录后 `/model` 出现 Claude 组(live 目录 + effort 档),发一条消息验证流式 + 工具(2026-08-20 `llm.models` 返回 Claude 组 10 个 live 模型、0 failures,Sonnet 5 含 low/medium/high/xhigh/max;隔离会话选中 `claude-sonnet-5` low,产生多段 `assistant/chunk`,read 工具 call/result 各 1,最终回复成功,0 error)
- [x] 4.4 若 4.1–4.3 任一失败:记录设置页 `detail` 文本,走回滚预案(见 6),并整理为上游反馈(4.1–4.3 全部通过,失败分支不触发)
- [x] 4.5 登出/重新登录一次,验证选择器目录免刷新更新(同一运行体内 Claude 目录 10→0→10,status true→false→true,重登仍为空 authorizeUrl)

## 5. ADR 与记账收尾

- [x] 5.1 确认 ADR-0001 已落在 `design.md`(Accepted),并复核 decision/consequences/重新评估触发条件
- [x] 5.2 将 ADR-0001 的"重新评估触发条件"镜像登记进 `BACKLOG.md`(避免选型结论被遗忘)
- [x] 5.3 (可选)README 或 docs 同步附一句升级/回滚说明(已加:`README.md`「第三方定制(remote)约定」段新增 `llm-subscriptions` 条目,含当前 pin 0.4.2、Claude 秒登录语义与回滚命令)

## 6. 验证与归档

- [x] 6.1 `openspec validate` 全绿(proposal/specs/design/tasks 结构合法;2026-08-20 `--strict --json` 1/1 passed)
- [x] 6.2 与用户确认验收结果,确认后 `openspec apply` + `openspec archive`(2026-08-20 用户确认;`openspec archive --yes` 完成,specsUpdated:true,5 added,归档于 openspec/changes/archive/)
- [x] 6.3 回滚预案存档:改回 `@0.3.1` + `dsh build` + 重启;codex 会话文件不受升级影响,可无损回滚(已存于 `design.md` Migration Plan 与 `dsh.yaml` 变更记录)
