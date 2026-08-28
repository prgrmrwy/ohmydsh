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
- [x] 4.2 确认 package 定制不再被整体跳过:13 项中 12 项完成物化并登记进 profile manifest
- [x] 4.3 在 devbox 上重跑 sync 确认幂等:无 `initialize profile` 行,已装 package 不重装
- [x] 4.4 在 devbox 上启动 DSH,确认 12 个 bundle 实际加载(启动清单可见)
- [x] 4.5 记录残留项:`dsh-open-in-vscode` 因 devbox 无法访问 github.com 而安装失败 —— 与本 change 无关的环境限制,详见下方说明

### 遗留:devbox 无法访问 github.com

devbox 可达 `registry.npmjs.org` 与内网 `bnpm.byted.org`,但对 `github.com:443` 连接超时。manifest 中三项经 GitHub URL 安装的定制里,`dsh-plugin-subscriptions` 与 `dsh-cockpit-bridge` 已在此前的运行中装好并被 pnpm 复用,只有 `dsh-open-in-vscode` 尚未落地,故每次 sync 都会重试并失败。

该包在 npm 上的同名条目是另一来源且 `0.2.0` 已被 unpublish,不能作为替代源。这属于环境网络限制,不是本 change 引入的问题,也不应通过修改共享 manifest(会同时影响可正常访问的机器)来规避。处置需用户决策:为 devbox 配置 GitHub 出网/镜像,或接受该机器少装这一项。

## 5. 收尾

- [x] 5.1 确认 delta 需求与最终行为一致
- [x] 5.2 运行 `openspec validate --strict`
- [ ] 5.3 实施与验证完成后归档该 change
