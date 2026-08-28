## 1. 入口快照与注入收窄（bin/dsh）

- [x] 1.1 在 `bin/dsh` 最开头（`source scripts/lib/dsh-runtime.sh` 之前、任何 npm 操作之前）快照用户显式 registry 到 `DSH_USER_REGISTRY`，覆盖 `npm_config_registry` 与 `NPM_CONFIG_REGISTRY` 两种拼写（design D1）
- [x] 1.2 删除 `bin/dsh:62-67` 的进程级 `export npm_config_registry`，保留从 `$REPO/.npmrc` 解析 `REPO_REGISTRY` 的逻辑与其注释中记录的动机
- [x] 1.3 新增一个 shell 辅助函数，把 `REPO_REGISTRY` 以命令前缀形式注入单次 npm/npx/pnpm 调用；将启动器自身发起的 npm 操作调用点改为经它调用
- [x] 1.4 核对 `scripts/check-update.mjs` 的版本检测仍与安装同源（`startup-autoupdate` 既有不变量不得破）

## 2. server 拉起路径去烘焙（bin/dsh + scripts）

- [x] 2.1 在 `scripts/` 侧暴露一个可被 `bin/dsh` 调用的入口，复用 `scripts/lib/dsh-cli.mjs` 的 `resolveCliBin()` 解析出 CLI 安装目录（含安装通道 A/B 的既有顺序），并返回其中的 **`node_modules/.bin/dsh` 符号链接路径**（非 `lib/bin.js`，design D2 归属门约束）
- [x] 2.2 改写 `start_server` 的**后台**路径（`bin/dsh:497`）：由 `nohup npx -y @deepseek-ai/dsh@$VER web ...` 改为 `node <.bin/dsh> web ...`，保留 `nohup`、日志重定向、`disown` 与 `PASSTHRU` 透传
- [x] 2.3 改写 `start_server` 的**前台**路径（`bin/dsh:479`）为同一机制，保留 `trap`/`wait` 信号语义
- [x] 2.4 在拉起 server 的环境上应用 D3 剥离清单（`npm_config_*`、`npm_lifecycle_*`、`npm_package_*`、`npm_command`、`npm_execpath`、`npm_node_execpath`）作为防御性兜底
- [x] 2.5 剥离后按 1.1 的快照结果重新注入用户显式 registry（快照非空时），确保逃生门保留
- [x] 2.6 确认 `scripts/lib/dsh-runtime.sh` 与 `tests/dsh-runtime.test.mjs` **零改动**：新 argv 形如 `node .../node_modules/.bin/dsh web ...`，仍命中 `is_dsh_web_pid()` 现有模式（design D2）

## 3. 测试

- [x] 3.1 新增测试：启动器解析 `REPO_REGISTRY` 后，其自身进程环境不含导出的 `npm_config_registry`（spec：注入不进入启动器进程环境）
- [x] 3.2 新增测试：传给 server 的环境中，D3 清单内的变量均已移除（spec：剥离清单）
- [x] 3.3 新增测试：入口快照非空时用户 registry 被保留并透传；快照为空时被剥离（spec：显式覆盖保留 / 隐式烘焙不被误认）
- [x] 3.4 新增测试：前台与后台两条路径产出的剥离变量集合一致（spec：前台与后台启动一致）
- [x] 3.5 确认 `tests/sync-dshcli.test.mjs` 中依赖 `npm_config_cache` 的既有用例仍通过（design D3：启动器自身在剥离前已读取该值）
- [x] 3.6 新增测试：2.1 解析出的 bin 路径以 `node_modules/.bin/dsh` 结尾，且由它构成的 server argv 能被 `is_dsh_web_pid()` 判定为 DSH（design D2 归属门不变量的回归保护）

## 4. 验证

- [x] 4.1 运行 `npm test`
- [x] 4.2 运行 `npm run check:artifacts`
- [x] 4.3 运行 `node scripts/sync.mjs` 两次，确认第二次无变化（幂等）
- [x] 4.4 冷启动验证：清空/移开 npx 缓存中的目标版本 bin 后执行启动，确认安装通道 A/B 仍能就绪并成功拉起 server（design Risks：绕过 npx 就绪保证）
- [x] 4.4b 归属门端到端验证：以新机制拉起 server 后执行 `dsh stop`，确认能正常停止（不返回 2「无法证明属于 DSH」）；再执行一次 `dsh restart` 确认往返正常
- [x] 4.5 `dsh restart` 后在 agent bash 中于**仓库外目录**（如 `/tmp`）执行 `npm config get registry`，确认得到 `~/.npmrc` 的内网源
- [x] 4.6 同上环境确认 `npm_config_engine_strict` 已不存在
- [x] 4.7 逃生门验证：`npm_config_registry=https://example.test/ dsh restart` 后在 agent bash 中确认得到 `https://example.test/`
- [x] 4.8 在 agent bash 中于内网仓库执行一次原本报 404 的 pnpm/rush 拉包，确认无需 `env -u` 即可成功（原始问题闭环）

## 5. 收尾

- [x] 5.1 若实现过程中发现 spec 与实现不一致，先更新 `openspec/changes/scope-npm-registry-injection/specs/` 再改代码
- [x] 5.2 运行 `openspec validate scope-npm-registry-injection --strict`
- [x] 5.3 归档 change（`openspec archive`），确认 `openspec/specs/launcher-npm-environment/spec.md` 已反映最终行为
