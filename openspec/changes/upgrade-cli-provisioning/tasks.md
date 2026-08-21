# Tasks — upgrade-cli-provisioning

## 1. CLI 实例解析与执行模块

- [x] 1.1 新建 `scripts/lib/dsh-cli.mjs`:导出纯函数 `computeNpxCacheKey(spec)`(sha512 摘要前 16 位,npm libnpmexec 算法,注释标明出处与版本约束)、`npxBinPathOf(spec, cacheDir)`(npx 缓存内 `node_modules/@deepseek-ai/dsh/lib/bin.js` 路径)、`pnpmCliDir(version)`(`~/.cache/ohmydsh/dsh-cli/<version>/`,尊重 `XDG_CACHE_HOME`)、`dshBinOf(dir)`(任一目录内 bin.js 路径)
- [x] 1.2 模块内实现 `resolveCliBin({ spec, dshBinEnv, npxCache, pnpmCacheBase })`:按 D1 探测顺序(DSH_BIN → npx 缓存 bin → 通道 A 就绪后再探 → 通道 B 直装后复用)返回 bin 路径或 null;通道 A 为单次串行 `npx -y <spec> --version`;通道 B 为 pnpm 直装固定目录(无 pnpm 时跳过);每个通道失败返回 null
- [x] 1.3 模块导出 `runDshCli(args, opts)`:解析 bin 路径后用 `node <bin> <args...>` spawn(stdio inherit),status 0 返回 true,其余返回 false;不重试安装

## 2. sync.mjs 接入

- [x] 2.1 `scripts/sync.mjs` 的 `dshCli` 改为调用 `runDshCli`(保留 `DSH_BIN` 优先语义与 `{version}` 参数;行为等价:原 npx 调用现在走解析后的 bin 直连)
- [x] 2.2 确认 sync.mjs 不再产生任何直接 `npx` spawn(除模块内部通道 A 的一次性就绪);保持既有 fail 语义(失败即 `fail()` → 升级回滚)

## 3. 测试

- [x] 3.1 新增 `tests/sync-dshcli.test.mjs`:key 算法与既有 npx 缓存目录名逐一一致(`2ede61d9d1d3d32e`=rc.7、`1f7e68c57f9c53b8`=rc.1、`de4831d60afe10da`=rc.2);`npxBinPathOf` 在真实 HOME 上解析出存在的 bin
- [x] 3.2 测试 `resolveCliBin` 决策:DSH_BIN 优先且跳过就绪;缓存命中直连;缺失时走通道分支(用临时目录与假 spec 验证通道选择与失败返回 null)
- [x] 3.3 运行 `npm test` 全绿;`node scripts/sync.mjs` 连续两次无变化(幂等)

## 4. 验证与收尾

- [x] 4.1 手工集成(本机):临时改名 npx 缓存 bin 目录模拟缺失 → `dsh build` 触发升级链 → 首次走安装通道、后续调用直连、升级成功并 commit;恢复现场
- [x] 4.2 `npm run check:artifacts` 通过;整理 change 状态与归档说明
- [x] 4.3 按压合后的 `openspec/specs/startup-autoupdate/spec.md` 复核 delta 语义一致,归档 change