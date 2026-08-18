# zydsh — DSH 定制仓

本仓库是 DSH(DeepSeek Harness)的定制仓:**总配置统一管理,各项定制可插拔、独立版本、独立维护,但都在同一仓库内**。

## 真相源约定

- **仓库是唯一真相源**。`dsh.yaml` + 各定制目录 = 完整配置;`~/.dsh` 是物化产物。
- `~/.dsh` 下手改**不保留**:`cordis.patch.yml` 由 sync 生成(带 generated 标记头),presets/skills 由 sync 复制。要改配置,回本仓库改,再 sync。
- **禁用 ≠ 删除**:`enabled: false` 只表示不物化,仓库内容保留,随时可重新启用。

## 目录结构

```
dsh.yaml                  # 总配置(唯一开关面)
BACKLOG.md                # 想法池
openspec/                 # spec-driven 变更流程
scripts/dsh.fish          # 锁版本启动 + dsh-sync
scripts/sync.mjs          # manifest → ~/.dsh 物化
packages/<name>/          # 自研 bundle 插件(见 packages/README.md)
presets/<id>/             # agent preset(见 presets/README.md)
patches/<id>.yml          # 纯 composition 片段 / 对 remote 包的覆盖(见 patches/README.md)
skills/<name>/            # skill(见 skills/README.md)
```

## 使用

**安装启动命令**(一次性,两 shell 的 PATH 均含 `~/.local/bin`):

```bash
ln -s /Users/bytedance/mydir/opensource/zydsh/bin/dsh ~/.local/bin/dsh
```

**日常**:

| 命令 | 行为 |
|---|---|
| `dsh` | **非阻塞启动**(类似 `dsh &`):未运行 → 后台拉起 + 就绪后开 UI;已运行 → 直接打开 UI;UI 也已打开 → 提示"已在运行" |
| `dsh --no-open` | 启动/检测时不自动打开 UI |
| `dsh --foreground` | 前台阻塞运行(调试用) |
| `dsh -b` | 重新 build(安装/同步 plugins)后再启动 |
| `dsh build` | 只 build,不启动 |
| `dsh -d` | 等价默认行为(兼容保留) |
| `dsh stop` | 停止 dsh web 进程 |
| `dsh reset` | **一键清零自定义 plugins**(移除全部自定义包、重置 patch 层、清掉 sync 出去的 preset/skill;可 `dsh build` 恢复) |
| `dsh history` | 查看历次启动清单(时间 / 版本 / 端口 / 加载的 plugins,记录在 `~/.dsh/dsh-startup.log`) |
| `dsh -p 8080` | 指定端口(默认 3080) |

- "build" = 按 `dsh.yaml` 物化到 `~/.dsh`(即 `node scripts/sync.mjs`,幂等可重跑);
- 版本单一来源:`dsh.yaml` 的 `dshVersion`,启动脚本运行时读取。

**打开 UI 的方式**(`DSH_OPEN_APP`,不写 shell 配置):

- 仓库根 `.env.local`(gitignored,已为你建好,模板见 `.env.local.example`)放 `DSH_OPEN_APP=...`,命令启动时自动 source;
- 或行内临时传:`DSH_OPEN_APP="xxx.app" dsh`(行内优先);
- 未设置 → 默认浏览器打开 `http://127.0.0.1:3080`;设置为 PWA 路径 → 直接开 PWA 窗口;设置为应用名 → 用该应用打开;
- 注意:PWA 打开自己的 start_url,自定义端口(`dsh -p`)时可能不一致,用 `--no-open` 规避。

sync 行为按定制类型:

| 类型 | source | 物化动作 |
|---|---|---|
| package | local | `dsh plugin add file:<packages/<id>>`(自动进 profile bundles) |
| package | remote | `dsh plugin add <spec>`(自动进 profile bundles) |
| preset | — | copy 到 `~/.dsh/.agent-presets/<id>` |
| patch | — | 按 manifest 顺序合并生成 profile `cordis.patch.yml` |
| skill | — | copy 到 `~/.dsh/skills/<id>` |

## 第三方定制(remote)约定

- 只存三样:**精确版本 pin**、**个人覆盖片段**(`patches/<id>.yml`)、**条目说明**(`note`/审查记录);**不 vendor 源码**。
- 升级 = 改 pin 重跑 sync;不自动漂移。
- **安全提醒**:插件即第三方代码(社区列表明示警告),安装前先看源码,`note` 记录来源与审查结论。

## 开发流

- 新想法 → `BACKLOG.md`;单项实施 → openspec change(`openspec new change <name>`);
- 自研 package 改代码后**要 bump 版本**(manifest 同步),sync 才会重装;
- DSH 升级后重跑 sync 恢复全部定制。
