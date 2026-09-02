## 1. 运行体策略与有界执行

- [x] 1.1 在 `scripts/lib/dsh-cli.mjs` 集中定义精确 spec 的临时 provision 策略，把 `@deepseek-ai/dsh@0.1.1-rc.2` 默认标记为跳过 npx，并实现 `DSH_ALLOW_NPX_PROVISION=1` 逃生门解析和可见提示。
- [x] 1.2 抽取可测试的有界 provision runner，支持 timeout、独立进程组、TERM→KILL 清理和包含 channel/spec/timeout 的失败结果，不再使用无界 `spawnSync` 安装探针。
- [x] 1.3 将 npx 与 pnpm provision 都接入有界 runner，保证受影响版本 cache miss 默认只走 pnpm，未受影响版本保持 npx-first 再 pnpm fallback。

## 2. 固定缓存完整性与并发

- [x] 2.1 将 pnpm 固定缓存准备改为同级 staging 安装、入口完整性验证和原子提升；失败/超时只清理 staging，不破坏已有有效缓存。
- [x] 2.2 为同一精确版本的并发 provision 增加单 owner 与有界等待，等待者只在成品入口可验证后复用，过期 owner 可安全恢复。
- [x] 2.3 更新解析失败诊断，明确精确版本、实际尝试/跳过的通道、缓存位置和 `DSH_ALLOW_NPX_PROVISION=1` 的一次性恢复方法，禁止静默换版本。

## 3. Launcher 接线与文档

- [x] 3.1 确认 `scripts/dsh-server-bin.mjs`、`scripts/dsh-cli.mjs`、sync 和 `bin/dsh` 全部复用同一策略，不在调用方复制 rc.2 特判。
- [x] 3.2 为 `dsh stop` 增加防回归断言，证明其在 server 存在/不存在两种情况下都在运行体解析前退出，不调用 registry、npx 或 pnpm；确认 restart 只解析一次运行体。
- [x] 3.3 更新 `README.md`/运维说明和源码策略注释，声明该 workaround 默认启用、用途与逃生门，并记录删除 gate：隔离冷 npx install、连续 build、重复 restart 均在 timeout 内通过。

## 4. 自动化与隔离验收

- [x] 4.1 扩展 `tests/sync-dshcli.test.mjs`：覆盖 rc.2 npx cache 命中零 provision、pnpm cache 命中零 provision、双 miss 默认不 spawn npx、逃生门恢复 npx-first、未来版本保持通用顺序。
- [x] 4.2 增加有界 runner 测试：正常完成、超时清理完整子进程组、非零退出诊断，以及已有缓存不被失败 provision 破坏。
- [x] 4.3 增加 staging/并发测试：半成品不被当作就绪、单 owner、等待者有界复用、失败后可重试和连续第二次解析零安装。
- [x] 4.4 运行 root `npm test`、`npm run check:artifacts`、相关 launcher/sync 测试与 `git diff --check`。
- [x] 4.5 在隔离 `HOME`/cache 下用 stub npx/pnpm 做冷缓存集成，证明 rc.2 默认路径从不调用 npx、成功后 build/start 直连同一精确入口；不停止当前 host。
- [x] 4.6 连续运行两次 `node scripts/sync.mjs`，确认第二次 `no changes`；审查 git diff 只包含 change、launcher/测试/文档，不包含 profile、缓存、凭据或生成产物。

## 5. 提交与后续实机验证

- [x] 5.1 将规范、实现、测试和说明提交为一个可独立 revert 的临时 workaround commit，不推送、不远程修改 lumevm/devbox。
- [ ] 5.2 用户稍后运行普通 `dsh restart` 后验证 host：无 npx 依赖计算、服务 HTTP 200、TraeX `models` RPC 由 0.1.8 Host handler 响应且配置保存不再报 `r.mutate`；该实机步骤完成前明确标记为待用户验证。
