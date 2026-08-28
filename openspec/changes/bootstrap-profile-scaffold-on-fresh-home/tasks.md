## 1. 复现并锁定缺陷

- [x] 1.1 在全新 `DSH_HOME` 上运行 sync,复现 `profile package.json missing`,并确认其次生后果是全部 package 定制被整体跳过
- [x] 1.2 定位前置来源:`syncPackages()` 与 `doReset()` 读取 profile manifest,但无任何步骤创建它
- [x] 1.3 确认运行体侧的真相源为 `@deepseek-ai/dsh-app-boot` 的 `PROFILE_TEMPLATES` / `initProfile`,且 `--dump-default-config` 会触发按需初始化
- [x] 1.4 新增 `tests/sync-profile-scaffold.test.mjs`,以假 CLI 复刻运行体的 init 与 add 语义,并让骨架缺失时的 add 失败

## 2. 实现骨架物化

- [x] 2.1 在 `scripts/sync.mjs` 新增 `ensureProfileScaffold()`:manifest 缺失时以 `--profile <name> --dump-default-config` 触发运行体 `initProfile`
- [x] 2.2 在 `main()` 中把该步骤前置于 reset 与全部 sync 动作
- [x] 2.3 幂等:manifest 已存在时直接返回,不调用 CLI,不触碰既有文件
- [x] 2.4 fail closed:骨架仍不存在时 `fail()` 报告首因,含目标 profile 与目录
- [x] 2.5 在 `scripts/lib/dsh-cli.mjs` 的 `runDshCli` 增加 `stdio` 透传,使副作用调用可丢弃配置树输出

## 3. 验证

- [x] 3.1 全新 `DSH_HOME` 运行 sync,确认零失败且 13 个 bundle 全部物化
- [x] 3.2 连续第二次运行确认为 `no changes`(幂等)
- [x] 3.3 全新 `DSH_HOME` 运行 `--reset`,确认不再报 manifest 缺失
- [x] 3.4 运行新增测试的四条路径(全新 home / 既有骨架 / reset / 物化失败)
- [x] 3.5 运行 `npm test` 与 `npm run check:artifacts`
- [x] 3.6 在既有 `~/.dsh` 上运行 sync,确认输出与此前一致且无骨架初始化行

## 4. 在真实全新机器上确认

- [x] 4.1 在 devbox(`n37-044-026`,全新 `~/.dsh`)上应用修复后运行 sync,确认 `profile package.json missing` 不再出现,且 profile 骨架由运行体模板物化
- [x] 4.2 确认 package 定制不再被整体跳过:13 项全部完成物化并登记进 profile manifest
- [x] 4.3 在 devbox 上重跑 sync 确认幂等:输出 `no changes`,无 `initialize profile` 行
- [x] 4.4 在 devbox 上启动 DSH,确认 bundle 实际加载(启动清单可见)

### 环境记录:devbox 到 github.com 的连通性不稳定

devbox 访问 `github.com:443` **间歇性**超时:实测 `curl -4` 8 次仅 2 次成功,pnpm 日志里也出现 `connect ETIMEDOUT 20.205.243.166:443`(IPv4 地址),重试若干次后才有一次成功。另有一条 IPv6 默认路由但出网是黑洞,`curl` 默认按 RFC 6724 优先 IPv6,因此不加 `-4` 时几乎必失败——但这只是叠加因素,**IPv4 本身同样不稳**。

诊断此类问题时的两点:一是不要用 `curl` 的探测结果推断 pnpm/git 的可达性(地址族偏好不同);二是不要用一两次探测下"通/不通"的二元结论,间歇性故障需要多次采样,并以实际执行该操作的客户端为准。

后果与处置:manifest 中三项经 GitHub URL 安装的定制在网络窗口内可装上,失败时重跑 sync 即可。`dsh-open-in-vscode@0.1.6` 现已就位,13 项全部物化,sync 为 `no changes`,`git fetch`(HTTPS)正常。

### 环境记录:local package 的 `lib/` 曾在 devbox 部署面缺失

现象:DSH 启动报 `ERR_MODULE_NOT_FOUND: .../dsh-sidebar-session-provider-icon/lib/index.js`,`dsh-worktree-session` 同样缺 `lib/`,而 sync 却报告 `no changes`。

成因是环境而非 sync 逻辑:首轮部署时(15:41)源码尚未构建出 `lib/`,pnpm 把当时的目录内容装进了 profile;随后 `lib/` 才在 16:47 构建出来。由于 pnpm 对 `file:` 依赖按目录整体缓存,后续 install 认为该 package 已是最新,不再刷新那份陈旧副本——被中断的首轮部署因此留下了一个"装过但内容不全"的中间态。

处置:删除 profile 中该 package 目录后重跑 `pnpm install`,pnpm 重新从源码复制,`lib/` 即就位。两个 TS package 修复后 DSH 启动零 `ERR_MODULE_NOT_FOUND`,13 个 plugin 全部加载,GUI 返回 200。

注:`dsh-subscriptions-sandbox-shim` 没有 `lib/` 是**设计如此**(其 `main` 指向 `./src/index.js`,无 build 脚本),不属于本问题。

已验证 sync 自身无此缺陷:在 Mac 上以全新 `DSH_HOME` 跑一次完整 sync,两个 TS package 的 `lib/` 均正确部署。故不改代码。

## 5. 收尾

- [x] 5.1 确认 delta 需求与最终行为一致
- [x] 5.2 运行 `openspec validate --strict`
- [ ] 5.3 实施与验证完成后归档该 change
