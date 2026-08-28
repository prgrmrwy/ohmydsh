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

### 一次误判的记录:devbox 的 IPv6 黑洞

首轮验证时 `dsh-open-in-vscode` 安装失败,我据 `curl https://github.com/...` 连接超时判定为"devbox 无法访问 github.com",并将其记为环境遗留。**该判定是错的**,此处保留以备复核。

实际原因:devbox 有一条 IPv6 默认路由和一个 global IPv6 地址,但 IPv6 出网是黑洞。`curl` 默认按 RFC 6724 优先 IPv6,于是固定 15s 超时失败(`connect=0.000000s`,典型丢包特征);而 Node/pnpm 与 `git` 走 IPv4,同一 URL 始终可达。证据:同一 URL 上 `curl -6` 超时、`curl -4` 返回 200、`node fetch` 返回 200,`pnpm add` 成功装出 `dsh-open-in-vscode@0.1.6`。

方法论教训:我把"用 curl 探测的结果"当成了"该主机的可达性",而真正执行安装的是 pnpm —— 不同客户端的地址族偏好不同,用 A 工具的失败去推断 B 工具的能力并不成立。诊断网络可达性时应当用实际执行该操作的客户端验证。

那次失败的真实成因是首轮安装期间的瞬时网络波动(同一批次里另两个 GitHub URL 装成功了,这一矛盾本应当场促使我深究,而不是写进文档)。重跑 sync 后 13 项全部装上,`dsh-open-in-vscode@0.1.6` 已就位,后续 sync 为 `no changes`。devbox 的 `git fetch`(HTTPS)亦正常。

## 5. 收尾

- [x] 5.1 确认 delta 需求与最终行为一致
- [x] 5.2 运行 `openspec validate --strict`
- [ ] 5.3 实施与验证完成后归档该 change
