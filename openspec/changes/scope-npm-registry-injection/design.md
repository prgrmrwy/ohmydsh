## Context

见 proposal.md — Why。设计上只需要抓住三个已实测确认的事实：

1. **`bin/dsh` 是从用户 shell 直接调用的 bash 脚本**（经 `~/.local/bin/dsh` 符号链接），它自身的启动环境不含任何 `npm_*` 变量。实测：从清空 `npm_*` 的 shell 调用脚本，脚本内 `npm_config_registry` 为 unset。这给了我们一个天然的「用户意图」判定时点。
2. **污染发生在 `start_server` 的 `npx -y @deepseek-ai/dsh@$VER web`**：`npx` 把解析后的完整配置（含仓库 `.npmrc` 的 `registry`、`engine-strict`，以及 `local_prefix`、`cache`、`yes` 等）烘焙成 `npm_*` 传给 DSH server（实测 PID 45811 → 45849 链路），server 再原样透传给 agent bash。DSH core 不参与，`@deepseek-ai/dsh-shell-env` 等包无任何 `npm_config` 处理逻辑。
3. **环境变量优先级高于所有 `.npmrc`**，且 `pnpm` 同样读取 `npm_config_*`（实测 `pnpm config get registry` 行为与 npm 一致），因此 rush/pnpm 工作流一并受影响。

约束：`startup-autoupdate` 要求版本检测（`scripts/check-update.mjs` 直连 npmjs）与 CLI 安装同源，这个不变量不能破。

## Goals / Non-Goals

**Goals:**
- 让 agent bash 的 npm 环境等价于「用户自己开一个终端」。
- 在不引入新判定歧义的前提下保留用户显式 `npm_config_registry` 覆盖。
- 剥离规则对前台/后台两条启动路径一致，且可被测试断言。

**Non-Goals:**
- 不改 `~/.npmrc`、仓库 `.npmrc` 或任何 `~/.dsh` 物化产物。
- 不改变 autoUpdate 的检测频道、升级时机或失败语义。
- 不试图在 DSH core 侧做 env 清洗（core 不是污染源，且我们不 vendor 其源码）。
- 不处理 `npm_config_cache`：`scripts/lib/dsh-cli.mjs:32` 的 `npxCacheDirOf()` 依赖它定位 npx 缓存，属于启动器自身的合法用途（详见 Decisions D3）。

## Decisions

### D1：用「启动器入口快照」区分用户意图与隐式烘焙

在 `bin/dsh` **最开头**（`source dsh-runtime.sh` 之前、任何 npm 操作之前）快照 `npm_config_registry` / `NPM_CONFIG_REGISTRY` 是否已存在：

```bash
DSH_USER_REGISTRY="${npm_config_registry:-${NPM_CONFIG_REGISTRY:-}}"
```

因为 `bin/dsh` 由用户 shell 直接调用，此刻存在的值只可能来自用户显式设置（inline env、shell export 或 `.env.local`）。后续剥离时，若快照非空则重新注入该值；为空则一律剥离。

- **为什么不用「值是否等于仓库 `.npmrc`」判断**：用户完全可能显式设置成与仓库相同的值，那样会被误剥离。且该判据在仓库 `.npmrc` 变更时行为漂移。
- **为什么不新增 `DSH_NPM_REGISTRY` 专用变量**：会要求用户改用非标准变量名，逃生门的通用性变差；标准 `npm_config_*` 本就是用户熟悉的接口。
- **fail-safe 方向**：spec 要求无法区分时按隐式处理（剥离）。快照法天然满足——任何非用户来源的值都不可能出现在入口时点。

### D2：server 以 node 直连 `.bin/dsh` 拉起，而非经 npx

两处 `npx -y "@deepseek-ai/dsh@$VER" web ...` 改为「解析出 CLI bin 路径 → `node <bin> web ...`」。

**关键顺序问题**：`npx` 自己会在 exec 目标前重新注入一批 `npm_*`——`env -u` 只能清掉传给 `npx` 的，清不掉 `npx` 自己烘焙的。因此剥离必须发生在 **npx 与 server 之间**，而不是 npx 之前；单靠给 `npx` 加 `env -u` 前缀无法达成目标。

复用仓库已有的解析通道：`scripts/lib/dsh-cli.mjs` 的 `resolveCliBin()` 已能定位 CLI 并 node 直连执行（`runDshCli` 中 `spawnSync(process.execPath, [resolved.bin, ...])`），本就是为消除 npx 安装锁竞争而建。首次安装仍可经 npx（短命的一次性安装进程，不是长期 server）。

实测对照（同一清空环境下拉起，统计子进程中 `npm_*` 变量数）：

| 拉起方式 | 泄漏 `npm_*` 数 | `npm_config_engine_strict` |
| --- | --- | --- |
| 经 npx（现状） | 22 | `true` |
| node 直连 bin | 0 | unset |

**`bin` 取 `.bin/dsh` 符号链接，不取 `lib/bin.js`**：`dshBinOf()` 返回的是 `node_modules/@deepseek-ai/dsh/lib/bin.js`，用它拉起会把 server 的 argv 变成 `node .../lib/bin.js web ...`，而 `scripts/lib/dsh-runtime.sh` 的 `is_dsh_web_pid()` 是 `dsh stop`/`restart` 在发信号前的 **fail-closed 归属证明**，只认 `*/node_modules/.bin/dsh web*` 与 `npm exec @deepseek-ai/dsh@* web*` 两种形式——`lib/bin.js` 形式会被判为「无法证明属于 DSH」(返回 2)，导致启动器停不掉自己拉起的 server，且连带 4.5/4.7 的 `dsh restart` 验证都无法进行。

改用同目录下的 `node_modules/.bin/dsh` 符号链接即可：它指向同一个 `lib/bin.js`（`node` 能直接执行符号链接），去烘焙效果相同（实测同为 0），而 argv 保持 `node .../node_modules/.bin/dsh web ...`，仍命中现有归属门。npx 缓存与 pnpm 直装目录（`~/.cache/ohmydsh/dsh-cli/<version>/`）两条通道下该符号链接均存在，故不需要按通道分支。

- **备选：扩展 `is_dsh_web_pid()` 支持 `lib/bin.js` 形式** — 被否。该函数是安全相关的 fail-closed 判定（`tests/dsh-runtime.test.mjs` 有「拒绝非 DSH 监听者」的用例），放宽它需要新增 spec 需求与测试；而符号链接方案零成本达成同一目的，不触碰安全路径。
- **备选：保留 `npx` 拉起，在 DSH server 侧清洗** — 被否，需要改 core 或写 patch，信任面和升级维护成本都更高。
- **备选：包一层 `env -u ... npx ...`** — 被否，如上，清不掉 npx 自身的注入。

### D3：剥离清单

移除 `npm_config_*`、`npm_lifecycle_*`、`npm_package_*`、`npm_command`、`npm_execpath`、`npm_node_execpath`。

D2 采用 node 直连后，这批变量本就不会被生成，剥离清单主要作为**防御性兜底**：覆盖「用户自己就是从 `npm run` 里调用 `dsh`」的场景（此时 `bin/dsh` 入口环境已被污染，D1 快照会把 registry 误判为用户意图——这是已知残留边界，见 Risks）。

`npm_config_cache` 属于该清单，但**启动器自身**在剥离前已通过 `npxCacheDirOf(process.env)` 读取过它，故不影响 CLI 解析；只是不再传给 server。

### D4：`installEnv()` 保持不变

`scripts/lib/dsh-cli.mjs:57-60` 的 `installEnv()` 只作用于单次 `spawnSync`，本就不泄漏到长期进程，符合新 spec 的「单次调用作用域」要求。仅需确认其显式覆盖判定与 D1 快照语义一致（两者都是「已设置则尊重」），无需改动逻辑。

## Risks / Trade-offs

- **[从 `npm run` 调用 `dsh` 时 D1 快照失真]** → 此时入口环境已含 npm 烘焙值，会被当作用户意图保留。属于已知残留边界；D3 的兜底清单不覆盖它（因为快照优先）。缓解：这是非主流调用方式（仓库文档一律引导 `~/.local/bin/dsh`），且后果是回到当前行为，不会更差。若日后需要，可加 `npm_command` 存在性作为「被包管理器调用」的旁证来抑制快照。
- **[改用 node 直连拉起 server，绕过 npx 的就绪保证]** → 必须确保 `resolveCliBin()` 的安装通道（A: npx / B: pnpm）在 bin 缺失时仍先跑。缓解：沿用 `runDshCli` 既有顺序，不新写解析逻辑；并在 tasks 中要求验证冷启动（清空 npx 缓存后首次启动）。
- **[server argv 变化会击穿 `dsh stop` 的 fail-closed 归属门]** → 这是 D2 的主要陷阱，已通过「取 `.bin/dsh` 符号链接而非 `lib/bin.js`」规避。缓解：`dsh-runtime.sh` 与其测试保持零改动，并在 tasks 中显式要求验证 `dsh stop`/`restart` 仍能停掉自己拉起的 server；若未来 `resolveCliBin()` 的返回形态变化，该不变量需重新验证。
- **[已运行的 server 不会自动获得新环境]** → 用户需 `dsh restart` 才生效。缓解：在变更说明和 tasks 验证步骤中明确要求重启后验证。
- **[agent 依赖某个 `npm_config_*` 的隐性行为可能消失]** → 例如脚本隐式依赖 `npm_config_yes=true`。缓解：这类依赖本就不应存在（agent 环境应等价于用户终端）；如发现具体依赖，应在 DSH 侧显式声明而非依赖泄漏。

## Migration Plan

1. 实施后本地 `dsh restart`，在 agent bash 中于仓库外目录验证 registry 回落到 `~/.npmrc`。
2. 回滚：本变更集中在 `bin/dsh`，`git revert` 后 `dsh restart` 即恢复。无持久化状态、无物化产物变更，无需数据迁移。
