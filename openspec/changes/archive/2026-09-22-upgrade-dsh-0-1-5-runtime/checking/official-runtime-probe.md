# 任务 3.1 验收证据:裸官方 `0.1.5-rc.2` 运行体 + CLI / launcher 路由

## 结论(先行)

**通过。** 不带本仓库 overlay 的官方 `@deepseek-ai/dsh@0.1.5-rc.2` 运行体在隔离环境中
自证健康:CLI 可跑、配置树可 dump、Web 可在非生产端口起并真实渲染、`plugin add/remove/why`
可跑通一轮完整往返。profile/launcher 路由的**每一格都有确定行为**,且**四类非法输入全部
fail closed 且退出码 1**。

三点必须记住的实测事实:

1. **官方 CLI 的动词面与本仓库 launcher 完全不同。** 官方只有 `web` 与 `plugin` 两个子命令;
   本仓库 launcher 包装出来的 `build` / `stop` / `restart` 在官方 CLI 里**根本不存在**。
2. **`desktop` 被四个入口一致拒绝**,报错文本完全相同,退出码均为 1。
3. `dsh plugin` 是 **pnpm 转发器**,因此 profile 目录会继承**用户级** `~/.npmrc` 的 registry。
   在 devbox 上这是内网镜像 `bnpm.byted.org`,其官方子包的 `latest` dist-tag 是**陈旧且损坏**的
   —— 这会让不带版本号的 `plugin add` 失败(详见 §7)。

---

## 1. 运行体身份与隔离

| 项 | 实测值 |
|---|---|
| 包 | `@deepseek-ai/dsh@0.1.5-rc.2`(registry 安装到一次性前缀) |
| 安装位置 | `/tmp/official-home-3x/prefix`(非仓库目录,无 overlay) |
| `node lib/bin.js --version` | `0.1.5-rc.2`,exit **0** |
| Node | `v22.23.2`(`~/.nvm/versions/node/v22.23.2/bin/node`) |
| 隔离 `DSH_HOME` | `/tmp/official-home-3x/h*`(`umask 077`) |
| 端口 | **3099**(3080/3081 全程未触碰) |

交叉核对:仓库内 `packages/dsh-pet/compat/subagent/.upstream` 与 `.storage-upstream` 均位于
`fb2c4b9 Merge pull request #3978 … release-dsh-0.1.5-rc.2`,即下文引用的上游文档确为**目标版本**文档。

## 2. CLI 实际动词与参数(实测 `--help` 原文)

```
Usage: dsh [options] [command] [args...]
Options:
  -V, --version                  output the version number
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --from-default-profile <name>  initialize a new custom profile from a shipped profile template
  --patch <path>                 extra patch-list overlay applied after the profile layer (repeatable)
  --dump-config                  print the composed profile tree and exit
  --dump-default-config          print the profile tree without its user layer or --patch overlays and exit
Commands:
  web [options] [args...]        boot the web profile (alias of --profile web)
  plugin [options] [args...]     manage a profile's plugins by forwarding the remaining arguments to pnpm
```

**动词只有 `web` 与 `plugin`。没有 `build` / `stop` / `restart` / `start`。**
`dsh web --help` 的 app 参数族:`--host`、`--no-open`、`--port`(0 = 系统选)、`--trusted-host`、`-h/--help`,exit 0。

> 与本仓库的差异已实测:本仓库 launcher 只接受 `build`/`stop`/`restart`,且 `dsh start` 报"无法识别的参数"
> (见 `rollback-drill.md`)。两者是**不同的命令面**,不要互相套用。

## 3. `--dump-config` / `--dump-default-config`(官方基线)

在全新 `DSH_HOME` 上对 `--profile web` 运行,exit **0**,两次输出 **字节完全相同**(新 profile 用户层为空)。

| 指标 | 实测值 |
|---|---|
| 输出大小 | 17,072 bytes |
| 分片(`# == ` 头)数 | 20 |
| loader 条目(`- id:` 行) | **152** |
| `name:` 行 | 152 |
| 唯一 id | **152** |
| **重复 id** | **0** |

分片构成:10 段 `@deepseek-ai/dsh-base`(37+1+1+1+4+1+3+4+4+3 行)与 10 段
`@deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app`(3+3+1+1+2+2+6+4+3 行),
末段 `@deepseek-ai/dsh-web-app`(68 行)。各分片 id 集合**互不相交**,故 152 即合成树全量。

**唯一的"重复名字"不是 id 冲突**:`@deepseek-ai/dsh-tool-subagent` 出现两次,但 id 不同 ——
`tool-subagent`(`provider: spawn`)与 `tool-subagent-fork`(`provider: fork`),同一包挂两份不同配置。
`provider` 在树中只作为 **config 字段**出现(`agent-default-model` 的 `provider: deepseek-official`、
上述 subagent 的 spawn/fork),**不存在名为 provider 的插件条目**。

## 4. Web(端口 3099)

| 探测 | 实测 |
|---|---|
| `GET /`(无 token) | **401**,body `dsh web authentication required; reopen the URL printed by dsh web.` |
| `GET /?token=<启动时打印>` | **303 See Other**,`set-cookie: dsh-auth-<hex>=v1.<payload>.<sig>`;`HttpOnly`、`SameSite=Strict`、`Max-Age=2592000` |
| 跟随 303(`curl -L -c/-b`) | **200**,index **27,724 bytes** |
| `GET /`(仅 cookie) | **200**,27,724 bytes |
| `GET /api/health`、`/api/settings` | **404**(该构建无此端点,非 fence 异常) |

index 引用 50 个 client 插件模块经 `/plugins/??…&rev=8854e9b2a8be` 聚合,以及 `./assets/index-*.js`。

**CDP DOM dump**(`chrome-headless-shell` + CDP `Runtime.evaluate`,非 `--dump-dom`;后者因长连接挂死,已弃用):

| 指标 | 实测值 |
|---|---|
| `document.readyState` | `complete` |
| `document.title` | `DeepSeek Harness` |
| `#root` / `[class*=sidebar]` / `[class*=composer]` / `[contenteditable]` / `button` | 1 / 1 / 2 / 1 / 11 |
| `document.body.innerText` 长度 | 621 |
| `documentElement.outerHTML` | **352,502 bytes** |

正文含真实产品文案:`Choose workspace to start`、`Standard mode`、`Internal Testing Notice`、
`DeepSeek Harness 0.1 remains in testing for Harness developers…`。**页面确实渲染,不是空壳。**

> 取证开销提示:token 出现在启动日志与 URL 中;本文档与所有落盘 DOM **均已脱敏**为 `REDACTED`,不落任何凭据。

## 5. profile / launcher 路由矩阵(逐格实测)

| # | 场景 | 命令 | exit | 实测行为 |
|---|---|---|---|---|
| A | **fresh custom** | `--profile rescue --from-default-profile web --dump-default-config` | **0** | 创建 `profiles/rescue/{cordis.yml,cordis.patch.yml,package.json,pnpm-workspace.yaml}`,输出与 web 树相同 |
| A2 | **existing custom + 再带 `--from-default-profile`** | 同 A 再跑一次 | **1** | `already exists at …/profiles/rescue/package.json; omit --from-default-profile to use it`,**不作修改** |
| A3 | **existing custom 不带该参数** | `--profile rescue --dump-default-config` | **0** | 正常复用,**幂等** |
| B | **fresh custom 不带该参数** | `--profile brandnew --dump-default-config` | **1** | `does not exist; create it with 'dsh plugin --profile brandnew add <package>'`;**未创建任何目录** |
| C | **shipped 名当目标** | `--profile web --from-default-profile web` | **1** | `is shipped and cannot be a custom profile target; omit --from-default-profile to use it` |
| D | **未知模板** | `--profile zzz --from-default-profile unknown` | **1** | `unknown default profile "unknown"; expected one of "acp", "headless", "sdk", "sdk-minimal", "web"` |
| E | **shipped profile 自动初始化** | `--profile {web,headless,sdk,sdk-minimal,acp}` | **0**×5 | 五个全部首次使用即从随附模板落盘并 dump 成功 |
| F | **克隆体真实启动(launcher 路由)** | `--profile rescue` @3099 | **0** | HTTP **200**,27,724 bytes —— 与 shipped web 完全一致,克隆体的 bundle 解析生效 |

要点:

- **内置模板全集 = `acp` / `headless` / `sdk` / `sdk-minimal` / `web`**(由 D 的报错文本直接给出,非猜测)。
- **`sdk-minimal` 是独立树**:首行分片为 `# == @deepseek-ai/dsh-sdk-minimal`,首条目 `sdk-app-startup`;其余四个均为 `base` + 模式 bundle 的栈。
- A 创建的克隆 manifest 实测为 `dependencies: {}`、`bundles: ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`、`patchReload: "live"` —— 即**依赖为空、记录为空、无继承字段**,与上游 profile-bundles 文档一致。它无需 `pnpm install` 即可启动(bundle 从 dsh 安装目录解析)。
- 失败格(A2/B/C/D)均以**未捕获异常的 Node 栈**形式输出(stderr 含 `Error: dsh: …` 与栈帧),非友好单行错误;退出码统一 1。

## 6. `desktop` 拒绝(四个入口)

| 入口 | 命令 | exit | 报错文本 |
|---|---|---|---|
| config dump | `--profile desktop --dump-default-config` | **1** | `error: profile "desktop" is managed exclusively by the Electron application` |
| boot | `--profile desktop --port 3099 --no-open` | **1** | 同上 |
| plugin add | `plugin --profile desktop add left-pad` | **1** | 同上 |
| plugin list | `plugin --profile desktop list` | **1** | 同上 |

四条入口文本**逐字相同**,且是**友好单行错误**(非栈),说明这是 launcher 的显式保留名断言,而非解析失败。

## 7. `plugin add` / `remove` / `why`

`dsh plugin --profile <name> <args…>` 实测就是 pnpm 转发器:`plugin --profile rescue --help` 打印的是
**pnpm 10.16.1 自己的 help**。因此下表的退出码即 pnpm 的退出码。

| 操作(在 `plug2` profile 上) | exit | 实测结果 |
|---|---|---|
| `plugin --help`(缺 `--profile`) | **1** | `error: required option '--profile <name>' not specified` |
| `add @deepseek-ai/dsh-headless@0.1.5-rc.2` | **0** | `bundles` 追加 `…dsh-headless`;stderr 仅 `dsh: initialized profile plug2 at …` |
| `why @deepseek-ai/dsh-headless` | **0** | 输出 `dsh-profile-plug2 … (PRIVATE)` + `dependencies: @deepseek-ai/dsh-headless 0.1.5-rc.2` |
| `add is-odd@3.0.1`(无 `dsh.bundle` 的公开包) | **0** | 仅进 `dependencies`;**`bundles` 不变**;stderr 警告 `dsh: warning: is-odd declares no dsh.bundle — installed as a plain dependency, not a profile layer (a later update that gains one activates it automatically)` |
| `why is-odd` | **0** | 输出含 `is-odd 3.0.1` |
| `remove @deepseek-ai/dsh-headless` | **0** | `bundles` 回收为 `["@deepseek-ai/dsh-base"]` |
| `remove is-odd` | **0** | `dependencies` 键整体消失 |

**`why` 能解释存在性**:它输出 pnpm 的依赖树(`dependencies:` 段 + `Legend:` 行),即该包**在 profile 里如何被引入**。
但注意一个实测边界:**对未安装的包 `why` 退出码 0 且输出为空**(在 `plugdemo` 上跑
`why @deepseek-ai/dsh-headless` 得到 exit 0、零输出),不报错也不提示。同一状态下
`remove` 则 exit **1**:`ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS Cannot remove '@deepseek-ai/dsh-headless': project has no dependencies of any kind`。

### 7.1 ⚠ 实测环境坑:`plugin` 继承用户级 registry

不带版本号 `add @deepseek-ai/dsh-headless` 时实测失败:

```
ERR_PNPM_FETCH_404  GET http://bnpm.byted.org/@deepseek-ai%2Fdsh-code-runtime-worker: Not Found - 404
This error happened while installing the dependencies of @deepseek-ai/dsh-headless@0.0.1-rc.1
```

根因已定位:

- `/tmp/.../profiles/<name>` **不在仓库内**,故 pnpm 不读仓库 `.npmrc`(仓库那份写的是
  `registry=https://registry.npmjs.org/`),而读**用户级** `~/.npmrc` → `http://bnpm.byted.org`。
- 在内网镜像上,`@deepseek-ai/dsh-headless` 的 **`dist-tags.latest` 仍是 `0.0.1-rc.1`**(陈旧),
  `next` 才是 `0.1.5-rc.2`;而 `@deepseek-ai/dsh` 本身的 `latest` 已是 `0.1.5-rc.2`。
  于是不带版本号解析到一个**老版本**,其依赖 `@deepseek-ai/dsh-code-runtime-worker` 在镜像上 404。
- 规避:显式钉版本(`@0.1.5-rc.2`)并令 `npm_config_registry=https://registry.npmjs.org/`,即上表的通过路径。

**另一个副作用**:`add` 失败时 profile **仍会被创建**(stderr `dsh: initialized profile plugdemo at …`,
留下 base-only 的 manifest)。即 `plugin add` 的"初始化"与"装包"不是原子的。

## 8. 状态汇总

| 断言 | 状态 |
|---|---|
| 官方 0.1.5-rc.2 裸运行体 `--version`/`--help` 可用 | **通过** |
| CLI 动词面被实测确认(`web`/`plugin`) | **通过** |
| `--profile web` dump 树条目数/重复 id 有确定值(152/0) | **通过** |
| 官方 Web 在非生产端口 200 且真实渲染 | **通过** |
| 路由矩阵 9 格逐格有 exit code 与文本 | **通过** |
| `desktop` 四入口一致拒绝 | **通过** |
| `plugin add/remove/why` 完整往返 | **通过** |
| `--from-default-profile` 克隆体能真实启动 | **通过** |

## 9. 仍未验证

- **未验证**:官方 Web 的**完整会话流**(发消息 → 模型响应)。需要 `DEEPSEEK_API_KEY`,本轮只做到
  "页面渲染 + HTTP 200",未做真实推理回合。
- **未验证**:`--patch` overlay 参数族(本轮未注入任何 `--patch`)。
- **未验证**:`headless`/`sdk`/`sdk-minimal`/`acp` 四个模板的**真实启动**(仅验证了 dump 与落盘;
  只有 `web` 与克隆体 `rescue` 真正起了服务)。
- **未验证**:本仓库 launcher 包装层与官方 CLI 的**参数透传**是否逐项等价(两者命令面不同,
  本轮未做映射对照)。
- **未验证**:`plugin add` 在**仓库内** profile 目录下的 registry 行为(本轮 profile 均在仓库外,
  这正是暴露镜像问题的条件)。
