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

- [x] 4.1 在 devbox 上拉取修复后执行 `dsh build`,确认一次跑通且无失败
- [x] 4.2 确认 devbox profile 的 bundle 列表与 manifest 一致
- [x] 4.3 在 devbox 上重跑 `dsh build` 确认幂等
- [x] 4.4 在 devbox 上启动 DSH,确认插件实际加载

## 5. 收尾

- [x] 5.1 确认 delta 需求与最终行为一致
- [x] 5.2 运行 `openspec validate --strict`
- [ ] 5.3 实施与验证完成后归档该 change
