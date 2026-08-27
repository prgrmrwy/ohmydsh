# ohmydsh — DSH 定制仓

本仓库是 DSH(DeepSeek Harness)的定制仓:**总配置统一管理,各项定制可插拔、独立版本、独立维护,但都在同一仓库内**。

## 真相源约定

- **仓库是唯一真相源**。`dsh.yaml` + 各定制目录 + `instructions/dsh-home.md` = 完整配置;`~/.dsh` 是物化产物。
- 根 `package-lock.json` 是全部 npm workspace 的唯一依赖锁；TypeScript local package 只提交 `src/`，gitignored `lib/` 由根 build/sync 生成。
- `cordis.patch.yml`、presets/skills 与 `$DSH_HOME/AGENTS.md` 都应从仓库修改后重新 sync。`AGENTS.md` 有 ownership/hash 漂移防护:发现未托管文件或本地改动时会报错并保留,不会静默覆盖或删除。
- OpenSpec checking 长期只提交报告、trail、gate、复现脚本或显式审核的 test fixture；raw history/baseline 和批量截图应放外部 artifact，或在报告中声明仅临时留存。
- 提交前运行 `npm test` 与 `npm run check:artifacts`，防止生成产物、nested lock、raw evidence 或重复架构图进入 Git。
- **禁用 ≠ 删除**:`enabled: false` 只表示不物化,仓库内容保留,随时可重新启用。

## 目录结构

```
dsh.yaml                  # 总配置(唯一开关面)
BACKLOG.md                # 想法池
openspec/                 # spec-driven 变更流程
scripts/bootstrap.sh       # clone 后初始化:检查 Node 环境 + 安装依赖(幂等)
scripts/install.sh         # 一键安装:bin/dsh → ~/.local/bin(幂等,可卸载)
scripts/sync.mjs          # manifest → ~/.dsh 物化
skills/dsh-tunnel/           # skill:SSH 隧道访问远端 DSH(含脚本,端口占用自动退避)
instructions/dsh-home.md  # 工作环境级模型指令源文件
packages/<name>/          # 自研 bundle 插件(见 packages/README.md)
presets/<id>/             # agent preset(见 presets/README.md)
patches/<id>.yml          # 纯 composition 片段 / 对 remote 包的覆盖(见 patches/README.md)
skills/<name>/            # skill(见 skills/README.md)
docs/notes/               # 可长期检索的问题与决策记录
tests/                    # sync 黑盒回归测试
```

## 架构图

<img alt="ohmydsh 架构图:仓库真相源 → sync 物化 → ~/.dsh → DSH 运行时" src="archify-out/ohmydsh-architecture.dual.svg" width="100%">

> 展示资产为 `archify-out/ohmydsh-architecture.dual.svg`(单文件,自带明暗主题适配);
> 可编辑图源为 `archify-out/ohmydsh-architecture.json`,架构变化时更新图源并重新导出该 SVG。

## 使用

**从零开始**(clone 以后到能用的完整流程;macOS / Linux / WSL / Git Bash 通用,`bin/dsh` 是 bash 脚本,Windows 原生不支持):

```bash
git clone <仓库地址> && cd ohmydsh
./scripts/bootstrap.sh     # ① 初始化:检查 Node 环境 + 安装依赖(只需一次,幂等)
./scripts/install.sh       # ② 安装 dsh 命令到 ~/.local/bin
dsh build && dsh           # ③ 物化定制配置并启动,UI 自动打开
```

- 前置要求:**Node.js >= 22 + npm >= 10**(推荐 `.nvmrc` 中的版本);根 `package.json` 的 `engines` 声明最低版本,bootstrap 只在低于最低版本时报错,更高版本仅提示不阻塞;
- 依赖出问题想重装:`./scripts/bootstrap.sh --force`;
- install.sh 默认装到 `~/.local/bin/dsh`(想换目录:`DSH_BIN_DIR=/opt/bin ./scripts/install.sh`);重复执行可覆盖更新,不影响 `~/.dsh` 物化产物;
- 装的是**相对符号链接**,仓库整体移动后命令依然可用,无需重装;
- 若 `~/.local/bin` 不在 PATH,脚本会打印各 shell(bash/zsh)的配置提示;
- 卸载:`./scripts/install.sh uninstall`;
- 跳过脚本?在仓库根执行等价的原始命令也行:
  ```bash
  ln -s "$PWD/bin/dsh" "$HOME/.local/bin/dsh"
  ```

**快速上手**(命令已装好;还没装?先看上面「从零开始」):

```bash
dsh build   # 1. 首次:按 dsh.yaml 把定制物化到 ~/.dsh(改了配置后也要重跑)
dsh         # 2. 启动:自动在后台拉起,就绪后打开 UI
dsh stop    # 3. 停止服务
```

- 想一步到位?"构建 + 启动"用 `dsh -b`;
- 启动后 UI 在 **http://127.0.0.1:3080**(换端口:`dsh -p 8080`);`web.lan` 开启时(默认关),启动输出会**同时打印局域网地址**,同网络设备可直接打开;
- 每次启动/停止,终端都会打印**当前加载的插件清单**,一眼看清生效了哪些定制;
- 重复执行 `dsh` 不会起第二个实例:已在运行就只是帮你把 UI 打开。

**日常命令**(按场景查):

| 场景 | 命令 | 说明 |
|---|---|---|
| 启动 | `dsh` | 未运行 → 后台拉起 + 打开 UI;已运行 → 打开 UI;UI 也已打开 → 提示"已在运行"。UI 打开策略:显式 `DSH_OPEN_APP`(PWA/应用)优先;未配置时自动探测已安装的 DeepSeek Harness PWA,命中即**只开 PWA**;否则浏览器 |
| 构建 + 启动 | `dsh -b` | 改过 `dsh.yaml` 或插件后,先重新物化再启动 |
| 只构建 | `dsh build` | 只把配置物化到 `~/.dsh`,不启动 |
| 停止 | `dsh stop` | 按监听端口验证并停掉 DSH server,同时关闭 PWA 与 Chrome 中同端口的 DSH 标签;非 DSH 进程占端口时拒绝误杀 |
| 重启 | `dsh restart` | 停 server → 关闭全部 UI → 确认端口释放 → 启动 server → 只打开 PWA(存在时),一步到位 |
| 看历史 | `dsh history` | 历次启动的时间 / DSH 版本 / 端口 / 插件清单(记录在 `~/.dsh/dsh-startup.log`) |
| 一键清空定制 | `dsh reset` | 移除自定义插件、preset、skill,并安全撤销托管的 `$DSH_HOME/AGENTS.md`(反悔了?`dsh build` 就能恢复) |
| 统一升级插件 | `dsh plugin-update` | 检测远端插件新版本(兼容性/稳定性判定)→ 逐条确认 → 改 `dsh.yaml` + sync + 自动提交;`--dry-run` 只预览,`--yes` 跳过确认;needs-review 条目永远等人工 |
| 调试 | `dsh --foreground` | 前台运行,日志直接打在终端 |
| 换端口 | `dsh -p 8080` | 默认 3080 |
| 不弹 UI | `dsh --no-open` | 启动/检测时不自动打开 UI |

小知识:"build" 就是按 `dsh.yaml` 物化到 `~/.dsh`(即 `node scripts/sync.mjs`,幂等可重跑);`DSH_HOME` 未设置或只含空白时默认 `~/.dsh`,也支持 `DSH_HOME=~/...`;DSH 版本单一来源是 `dsh.yaml` 的 `dshVersion`,启动时动态读取。

**自动升级 DSH 运行体**(`autoUpdate`,默认开):

- `dsh`(未运行)/ `dsh -b` / `dsh build` / `dsh restart` 前置会检测 `@deepseek-ai/dsh` 在 registry 目标频道(`latest` 或 `next`)的最新版本;低于最新即**阻塞式自动升级**再继续:改 `dsh.yaml` 的 `dshVersion` + 同族 `@deepseek-ai/dsh-*` pin → 重跑 sync 物化 → `git commit --no-verify`(`chore(dsh): auto-bump <旧> → <新>`)→ 再启动;
- 只会自动改写名字匹配 `@deepseek-ai/dsh-*` 且 pin 等于旧运行体的条目,第三方插件与刻意钉住的其他版本不动;改写前留 `dsh.yaml.bak`,sync 失败即从备份回滚并报错不启动;
- **前提是工作区干净**:仓库有未提交改动时不升级,输出会说明原因(提交后下次启动自动跟上);检测失败/离线时按当前版本继续,不阻塞;
- **逃生门 & 频道**:想钉在旧版,`dsh.yaml` 置 `autoUpdate.enabled: false` 或临时 `DSH_SKIP_UPDATE=1 dsh`;追 `next`(前夜版)用 `DSH_UPDATE_CHANNEL=next dsh`(或改 `autoUpdate.channel`);
- 升级/跳过/离线事件记录在 `~/.dsh/dsh-startup.log`,`dsh history` 可见。

**局域网访问**(`dsh.yaml` 的 `web.lan`,**默认关闭**):

- 需要时把 `web.lan` 改为 `true` 后 `dsh build`;sync 会把 webserver 绑到 `0.0.0.0`,启动时除 `http://127.0.0.1:<端口>` 外同时打印局域网地址 `http://<本机IP>:<端口>`,同一局域网的其他设备(手机/平板等)可直接打开;
- ⚠️ 安全提示:绑定局域网意味着同网段任意设备都能访问并驱动完整 agent 能力(bash、文件读写等),这是官方 CLI 出于安全故意禁用的;请只在可信网络、需要时临时开启,用完改回 `false` 后 `dsh build`;
- 不想改配置文件?`.env.local`(gitignored)或行内传 `DSH_LAN=1` / `DSH_LAN=0` 即可覆盖开关(优先级高于 `dsh.yaml`,如 `DSH_LAN=1 dsh` 临时开启),同样需要 `dsh build` 让绑定生效;
- 临时单次仅本机:`dsh --host 127.0.0.1`;
- macOS 首次开放端口可能弹防火墙询问,选择允许 node 接受传入连接。

**UI 打开方式**(用 `DSH_OPEN_APP` 控制,不用改 shell 配置):

- 默认:系统默认浏览器打开 `http://127.0.0.1:3080`;
- 想用 PWA 窗口 / 指定 App 打开:仓库根 `.env.local`(gitignored,模板见 `.env.local.example`)写 `DSH_OPEN_APP=...`,启动时自动生效;也可以临时 `DSH_OPEN_APP="xxx.app" dsh`(行内优先);
- 注意:自定义端口(`dsh -p`)时 PWA 打开的是自己的 start_url,可能对不上,这种情况用 `--no-open` 手动开。

sync 行为按定制类型:

| 类型 | source | 物化动作 |
|---|---|---|
| package | local | `dsh plugin add file:<packages/<id>>`(自动进 profile bundles) |
| package | remote | `dsh plugin add <spec>`(自动进 profile bundles) |
| preset | — | copy 到 `~/.dsh/.agent-presets/<id>` |
| patch | — | 按 manifest 顺序合并生成 profile `cordis.patch.yml` |
| skill | — | copy 到 `~/.dsh/skills/<id>` |

顶层 `dependencies:` = 无 bundle 的支撑包(如 remote 定制缺失的 peer),精确版本 pin 装为 plain dependency、**不进 bundle 层**;定制条目用 `deps:` 引用其包名声明归属(安装仍以顶层列表为唯一入口,sync 校验引用,悬空引用报错)。

顶层 `web.lan`(布尔)不是 customization:开启时 sync 额外生成一条 webserver 绑 `0.0.0.0` 的 patch fragment(见「局域网访问」);`DSH_LAN` 环境变量可覆盖(见 `.env.local.example`)。

## 环境级 instructions

顶层 `agentInstructions` 不是一种 customization type。启用时,sync 校验 `source` 是仓库内相对文件,加 GENERATED/provenance 头后原子写入 `$DSH_HOME/AGENTS.md`,并在 `.dsh-sync-state.json` 记录来源与部署哈希。连续 build 幂等;禁用、删除字段或 `dsh reset` 时,只会删除仍匹配已部署哈希的目标。目标若已有未托管内容,或托管后被修改,sync 会保留文件并报错,要求人工决定如何处理。

DSH 官方 `standard` preset 会自动加载,无需复制出 `ohmydsh` preset。`$DSH_HOME/AGENTS.md` 给该 DSH 工作环境提供前馈模型指导;它不是权限授予,也不是强制安全边界,实际能力始终由最新 runtime context 与工具执行策略决定。`dsh-sandbox-notes` skill 继续保留,用于需要时查阅完整背景与恢复细节。

现象、迁移原因、错误恢复规则与验证步骤见 [`docs/notes/dsh-home-agent-instructions.md`](docs/notes/dsh-home-agent-instructions.md)。

## 第三方定制(remote)约定

- 只存三样:**精确版本 pin**、**个人覆盖片段**(`patches/<id>.yml`)、**条目说明**(`note`/审查记录);**不 vendor 源码**。
- 升级 = 改 pin 重跑 sync(默认由 `autoUpdate` 自动完成,见上方「自动升级」;`DSH_SKIP_UPDATE=1` 恢复纯手工改 pin 模式)。
- **安全提醒**:插件即第三方代码(社区列表明示警告),安装前先看源码,`note` 记录来源与审查结论。
- **`llm-subscriptions` 订阅 provider 插件**(`dsh-plugin-subscriptions`,当前 pin `0.5.2+pr40.d927e3a` = 上游 PR #40「按模型默认推理档」临时 fork tarball,设置页每模型默认档列表收起,详见 `dsh.yaml` 条目 note;上游合并发版后切回 npm):Claude 登录 = 导入本机 Claude Code 凭据(秒登录,不弹 OAuth),升级与选型细见 change `openspec/changes/2026-08-20-llm-subscriptions-upgrade`(含 ADR-0001)。**回滚**:`dsh.yaml` 该条目 `spec`/`version` 改回 `dsh-plugin-subscriptions@0.5.2` / `0.5.2`(或删除临时条目) → `dsh build` → 重启;codex 会话不受影响,可无损回滚。

## 开发流

- 新想法 → `BACKLOG.md`;单项实施 → openspec change(`openspec new change <name>`);
- 自研 package 改代码后**要 bump 版本**(manifest 同步),sync 才会重装;
- DSH 运行体由 `autoUpdate` 自动升级并重跑 sync 恢复全部定制;手工升级同样 = 改 `dshVersion` 后重跑 sync。
