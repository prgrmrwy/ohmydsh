# devbox 上 node-pty 在 Linux 从未构建成功(顺带更正归档 7.1 的一处过度声明)

## 结论先行

- devbox(Linux)上 better-sidebar 的终端**从一开始就不可用** —— `node-pty` 的
  `pty.node` **从未被构建出来**。
- 根因是**三层叠加**,任一层单独都不足以致障(见 §2)。
- 已修复并验证;同时**更正归档 7.1 里一条不成立的 node-pty 证据**(§6)。

## 1. 症状

GUI 横幅:

```
Terminal dependency node-pty failed to load
Run the command below in a terminal or cmd on the DSH machine to repair it, then retry
(node-pty stays in sync with the DSH core version): (detected profile: web)

bash "<DSH_HOME>/profiles/web/node_modules/dsh-better-sidebar/scripts/install.sh" --repair --profile "web"
```

加载器的原始报错(直接 `require` 得到):

```
Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-x64:
Error: Cannot find module './prebuilds/linux-x64//pty.node'
```

## 2. 根因:三层叠加

| 层 | 事实 | 单独是否致障 |
| --- | --- | --- |
| ① 发布物 | **node-pty 1.1.0 不带 Linux 预编译** —— `prebuilds/` 只有 `darwin-arm64` / `darwin-x64` / `win32-arm64` / `win32-x64`,Linux 必须**源码构建** | 是(但可构建绕过) |
| ② 包管理器 | **pnpm 10 默认拦截依赖的构建脚本** ⇒ node-pty 的 `install` 从不执行;缺 `onlyBuiltDependencies` 许可 | 是 |
| ③ 工具链 | node-pty 的 `install` 是 `node scripts/prebuild.js \|\| node-gyp rebuild`;而 node-gyp 的 **gyp 是 Python 写的,用了海象运算符 `:=`(需 Python ≥ 3.8)**,devbox 的 `/usr/bin/python3` 是 **3.7.3**(Debian buster) | 是 |

第 ③ 层的真实报错:

```
File ".../node-gyp/gyp/pylib/gyp/__init__.py", line 211
    if flags := os.environ.get(env_name) or []:
              ^
SyntaxError: invalid syntax
gyp ERR! configure error
```

**对照组**:Pet compat launcher 自己那份 node-pty 是 **1.2.0-beta.15**,其发布物**自带**
`prebuilds/linux-x64/pty.node`(75 976 B,安装时间即落盘时间),所以它一直正常 ——
这也解释了为什么"运行体里有 pty.node"与"插件终端不可用"能同时成立(§6)。

## 3. 为什么插件自带的修复命令在这里无效

`dsh-better-sidebar/scripts/install.sh --repair` 写的是 **`allowBuilds`(pnpm 11 的键)**,
而 devbox `PATH` 上的 pnpm 是 **10.16.1**(pnpm 10 的键是 `onlyBuiltDependencies`)⇒
构建脚本依旧被跳过,`pnpm rebuild node-pty` **静默无输出**。

**即使换对键,仍会撞上第 ③ 层** —— 所以"跑一次插件给的修复命令"这条路在本机走不通,
不是操作问题。

机器上有**两个 pnpm**,容易选错:

| 路径 | 版本 |
| --- | --- |
| `/usr/bin/pnpm`(PATH 命中) | **10.16.1** |
| `~/.local/share/pnpm/pnpm` | 10.23.0 |

## 4. 处置(devbox)

1. profile 级 `.npmrc` 追加 `python=/usr/local/bin/python3.13`
   (devbox 除 buster 自带的 3.7.3 外,**另有 `/usr/local/bin/python3.13` = 3.13.5**)。
2. `pnpm-workspace.yaml` 增加 `onlyBuiltDependencies: [node-pty, protobufjs]`
   (保留脚本写的 `allowBuilds`,两者并存,互不冲突)。
3. `pnpm rebuild node-pty` → `gyp info ok`,产出 `build/Release/pty.node` **84 776 B**。

两者都**不由 `scripts/sync.mjs` 托管**(该脚本只在注释里提到过 `pnpm-workspace.yaml`),
所以改动不会被下次 `dsh build` 覆盖。

## 5. 验证

| 判据 | 结果 |
| --- | --- |
| **可复现性** | **删掉 `build/`** 后**不带任何参数**跑 `pnpm rebuild node-pty` → 完整编译链接(`CXX` → `SOLINK_MODULE` → `COPY Release/pty.node` → `gyp info ok` → `postinstall: Done`),产物同样 **84 776 B** |
| 直接加载 | `require('node-pty')` 成功,`exports: spawn,fork,createTerminal,open,native` |
| **真实 PTY** | `spawn('/bin/sh', ['-c','echo pty-ok'])` 经数据通道回 **`pty-ok`** |
| **运行体侧** | 重启后 Host `/proc/<pid>/maps` 中出现 **profile 的** `profiles/web/node_modules/node-pty/build/Release/pty.node`(修复前**只有** launcher 那份) |
| **GUI** | 报错横幅**消失**(`node-pty failed to load` 在页面文本中零命中) |
| 回归面 | `dsh restart` exit 0;健康 `401`;Host 进程代理变量 **0**;Pet `ready — routes registered` + `subscription connected` |

## 6. ⚠ 更正:归档 7.1 里一条不成立的证据

归档 tasks 的 7.1 原文写:

> **node-pty 单实例**:Host `/proc/<pid>/maps` 中 `pty.node` 唯一路径数 = **1**

**这条不成立**:

- 那唯一一条是 **Pet compat launcher 自己的** node-pty
  (`.launcher-builds/<fp>/node_modules/node-pty/prebuilds/linux-x64/pty.node`);
- **profile 的** node-pty 当时**根本没被加载** —— 它压根构建不出来(§2)。
- 也就是说该检查**并未**证明 better-sidebar 的终端可用。
- 修复后 maps 里是 **2 条不同路径**,按原判据反而"不合格" —— 判据本身是错的。

**教训**:`/proc/<pid>/maps` 里同名原生模块出现几次,只能证明"**有某个**消费者加载过它",
**不能**证明"**我关心的那个包**是单实例/可用"。要区分必须看**路径属于哪个部署面**。

## 仍未验证

- **终端 UI 里真正输入命令并拿到输出** —— 未做成:CDP 没找到「终端」入口按钮(`NO_BUTTON`),
  只验证到"横幅消失 + 运行体加载了 profile 的 pty.node + 直接 spawn 可用"。
  **终端面板的实际交互未验。**
- macOS / Windows 上的同类路径未验(那些平台有预编译,大概率无关)。
- 本次改动**只做了 devbox**;host/lumevm 若也遇到,需同样处置(它们是否 Linux 未知;
  注意 `.npmrc` 里的 python 路径是**机器私有**的,不能照搬)。
- 未验证"`dsh plugin add` 重新安装 better-sidebar 后 `build/Release` 是否会被清掉并需要重建"。
