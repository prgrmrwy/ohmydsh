## 1. `.ws/prepare-preview`

- [x] 1.1 新增 `scripts/lib/ws-preview-seed.mjs`：白名单常量；以 `WS_SOURCE_DSH_HOME` 为来源；写入前校验 `WS_DSH_HOME` 位于 `<WS_GIT_COMMON_DIR>/ws/dsh-home/` 下且不等于来源 home、`WS_WORKTREE` 等于仓库根；文件复制（tmp + rename、0600、内容未变则跳过）；缺失项列为 skipped
- [x] 1.2 `.credentials.yaml` 合并（源中的 browser-session 不复制，目标中已有的保持原值）；`auth.json` 原样复制，打印各账号有效期与 codex 登录风险提示
- [x] 1.3 前置：隔离 home 无 `profiles/web/package.json` 时失败并提示先 `dsh build`，零写入；`cordis.patch.yml` 在锚点后按 id 替换或追加，找不到锚点即失败
- [x] 1.4 `.npmrc` 只合入 registry 行
- [x] 1.5 首选端口：已登记则沿用；否则按 operationId 哈希映射到 3180–3279，写入 `ws-preview managed` 托管块（不探测、不扫描）
- [x] 1.6 新增可执行、受 Git 跟踪的 `.ws/prepare-preview` 薄壳；输出 memex 共享提示与下一步命令
- [x] 1.7 新增 `.ws/teardown-preview`：读取隔离 home 的 `preview.json`，仅在端口监听者身份一致时停止预览 Host；无记录或已停止视为成功；随后删除播种的凭据文件
- [x] 1.8 `tests/ws-preview-seed.test.mjs`：白名单与排除项、`auth.json` 与来源逐字节一致、两边都有 browser-session 且值不同时保留隔离 home 的值、未 build 时零写入并提示、幂等（第二次零写入）、预览本地 Session 与 browser-session 保留、真实 home 哈希不变、越界或等于来源的 home 被拒且零写入、首选端口对同一 operationId 稳定、重跑不变

## 2. launcher

- [x] 2.1 `args.mjs`：port 初值不再固定，记录 `portExplicit`，HELP 说明 `DSH_PORT` 与预览退避；主 checkout 仍按 `--port` → `DSH_PORT` → 3080 解析
- [x] 2.2 护栏：隔离 home 下目标为 3080 时，在任何副作用之前拒绝 start、restart、stop；build 开始前打印"隔离构建 → <home>（日常 GUI 未更新）"
- [x] 2.3 预览记录 `preview.json`（port、pid、created）：stop 只在身份一致时调用 `stopServer`，否则清除过期记录且不发信号
- [x] 2.4 启动退避：从首选端口（restart 时从原端口）起在 3180–3279 内偏移并回绕，最多 20 次，跳过 3080；端口非 empty 即跳过；就绪判据为监听者 pid 等于本次子进程；隔离 home 下禁用 racedOwner"他人抢先即成功"分支，改为回收自己的子进程后继续偏移；成功后原子写 `preview.json`，打印"隔离预览环境"与 `DSH_PREVIEW` 行
- [x] 2.5 测试（launcher-args、launcher-lifecycle，注入 probe/spawn）：首选端口被无关进程占用时偏移且不终止占用者；两个并发启动落到不同端口且各自报告自己的端口；输掉 bind 的一方不把对方报告为自己；显式 `--port` 不偏移；区间耗尽报错；stop 遇到身份不一致不发信号；worktree 下 3080 被拒且未调用 stop 或 probe；主 checkout 行为不变
- [x] 2.6 测试：teardown 在身份一致时停止、身份不一致时不发信号并成功退出、无记录时成功

## 3. 指令与文档

- [x] 3.1 `instructions/dsh-home.md`：验收顺序改为"有验收需要时在 worktree 内 `dsh build` → `ws prepare-preview` → `dsh` 预览验收（以 `DSH_PREVIEW` 给出的端口为准）→ 合入 → 主 checkout `dsh build` → 用户重启"
- [x] 3.2 `skills/add-dsh-plugin/`：同步更新验收步骤
- [x] 3.3 `BACKLOG.md` B014：修订"预览不复制凭据"原则，记录两个 change 覆盖的部分

## 4. 验证

- [x] 4.1 `npm test`、`npm run check:artifacts`
- [x] 4.2 在 worktree 中自举：执行 `dsh build` → `ws prepare-preview` → `dsh`；在 `DSH_PREVIEW` 给出的端口用 Host API 跑通一次真实模型回合；确认 3080 pid 未变、真实 home 白名单文件哈希一致、预览中订阅账号可用
- [x] 4.3 worktree 内 `dsh restart --port 3080` 被拒；在首选端口放一个占位监听后执行 `dsh`，确认偏移到下一端口且占位进程未被终止
- [x] 4.4 `openspec validate ohmydsh-worktree-preview --strict`
