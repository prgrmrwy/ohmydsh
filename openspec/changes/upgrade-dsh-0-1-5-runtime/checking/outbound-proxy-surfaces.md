# 任务 8.4:0.1.5 出站代理面(devbox 实测 + 源码证据)

被测对象:devbox `n37-044-026`,Host pid **2308857**,端口 **3080**,`$DSH_HOME=/home/zhangyong.617/.dsh`,
运行体 `dshVersion=0.1.5-rc.2`。本轮**只读探测**:未重启 Host、未改 `dsh.yaml`、未跑 `dsh build`;
在 devbox 上的写入仅限 `/tmp/pkg-probe-dsh/**`。

> **代理凭据自检**:本文件出现的代理串只有 `http://sys-proxy-rd-relay.byted.org:8118`(**不含 userinfo**,
> 非凭据);不含任何 token、Cookie 值、`Authorization`、代理口令。文末附自检命令与结果。

## 结论(速览)

| 项 | 结果 |
|---|---|
| Host 进程(pid 2308857)代理环境变量数 | **0**(`http_proxy`/`https_proxy`/`HTTP_PROXY`/`HTTPS_PROXY`/`all_proxy`/`ALL_PROXY`/`no_proxy`/`NO_PROXY` 全无) |
| 登录 shell(zsh -lic)代理环境变量数 | **0**(与 Host 一致;但 `.zshrc` 里备有手动启用代理的 alias) |
| 回环 RPC 是否直连 | **是** —— 双证据:故意不可达代理下 Node fetch 仍到达 Host;源码 `if (isLoopbackHost(url.hostname)) return void 0;` |
| 七个执行面 | 见 §3:6 个走全局 dispatcher(**由进程环境决定**),`subscriptions` **优先吃自己的插件配置**;`Pet-lark` 子进程只做**原样继承**(不发布策略) |
| 项目 `.env` 注入 | **代理/引导类名字被 fail-closed 拒绝**;普通名字**会被载入**(需精确表述,见 §4.1) |
| 候选不读生产 `$DSH_HOME/.env` | 结构上成立(读的是 `resolveDshHome()`);生产 `$DSH_HOME/.env` **不存在**,故**无法构造正例** |
| child / workflow / code-runtime 继承差异 | **有明确结论,且三者互不相同**,见 §5 |

DSH **没有**独立于环境的"出站代理配置面":策略 100% 来自启动环境快照,在第一个插件挂载前一次性安装
(`$L/dsh/lib/profile-boot-Dk-7KqJc.js:280 installProxyFromEnvironment(options.environment, …)`)。
唯一的"插件自带代理配置"是 `subscriptions` 的 `~/.dsh/plugins/subscriptions/proxy.json`。

---

## 1. Host 进程实际环境 —— 通过(实测,计数 = 0)

```bash
$ tr '\0' '\n' < /proc/2308857/environ | grep -icE 'proxy|no_proxy'
0
$ tr '\0' '\n' < /proc/2308857/environ | sed 's/=.*//' | sort | tr '\n' ' '
_ DBUS_SESSION_BUS_ADDRESS DSH_HOME DSH_TRAEX_BRIDGE HOME LANG LC_CTYPE LOGNAME MAIL
OLDPWD PATH PWD SHELL SHLVL SSH_CLIENT SSH_CONNECTION USER XDG_RUNTIME_DIR
XDG_SESSION_CLASS XDG_SESSION_ID XDG_SESSION_TYPE
```

**结论:Host 进程代理变量数 = 0** ⇒ DSH 侧解析为 `DIRECT_POLICY`(`source:"none"`),
即"构建期代理被长驻 Host 继承"这一历史坑**在本轮未复现**。

### 1.1 登录 shell 与 Host 进程的差异(支撑"真实运维约束")

```bash
$ zsh -lic 'env | grep -i proxy || echo NONE'
NONE
$ zsh -lic 'env | cut -d= -f1 | sort' > zsh.keys ; tr '\0' '\n' < /proc/2308857/environ | cut -d= -f1 | sort > host.keys
$ comm -23 host.keys zsh.keys   # host-only
DSH_HOME DSH_TRAEX_BRIDGE
$ comm -13 host.keys zsh.keys   # login-only
LESS LS_COLORS LSCOLORS MEEGO_BASE_URL MEEGO_PLUGIN_ID MEEGO_PLUGIN_SECRET MEEGO_PROJECT_KEY
NVM_BIN NVM_CD_FLAGS NVM_DIR NVM_INC PAGER ZSH
```

- 两边**代理变量都为 0**。
- 差异只在身份类变量:Host 独有 `DSH_HOME`、`DSH_TRAEX_BRIDGE`;登录 shell 独有 `MEEGO_*`、`NVM_*`、`PAGER`、`ZSH`。
- **代理不是默认开启的,而是"按需手动启用"的运维动作**(`~/.zshrc:112-114`,原样引用):

```bash
# proxy
alias set_sh_devbox_proxy="export http_proxy=http://sys-proxy-rd-relay.byted.org:8118 https_proxy=http://sys-proxy-rd-relay.byted.org:8118 no_proxy=.byted.org"
alias unset_sh_devbox_proxy="unset http_proxy https_proxy no_proxy"
```

⇒ 这是**真实运维约束**:devbox 上出网需人工 `set_sh_devbox_proxy`;而 Host 是**在那之前/之后**被拉起的,
所以是否继承代理取决于**启动那一刻的 shell 状态**,不是配置保证。这正好解释了历史坑的成因。

### 1.2 历史指纹:一个孤儿 lark-cli 仍带着代理(实测)

```bash
$ ps -o pid=,ppid=,lstart=,args= -p 2300412
2300412  1  Tue Sep 22 01:39:29 2026  /usr/lib/node_modules/@larksuite/cli/bin/lark-cli event _bus --profile dsh-pet --domain https://open.feishu.cn
$ tr '\0' '\n' < /proc/2300412/environ | grep -i proxy
no_proxy=.byted.org,localhost,127.0.0.1,::1,[::1]
https_proxy=http://sys-proxy-rd-relay.byted.org:8118
http_proxy=http://sys-proxy-rd-relay.byted.org:8118
HTTP_PROXY=http://sys-proxy-rd-relay.byted.org:8118
HTTPS_PROXY=http://sys-proxy-rd-relay.byted.org:8118
NO_PROXY=.byted.org,localhost,127.0.0.1,::1,[::1]
```

注意 `no_proxy` 已被**合并进回环字符串**(`.byted.org,localhost,127.0.0.1,::1,[::1]`)——这是
`dsh-http-proxy` 的 `withLoopback` 指纹(`$L/dsh-http-proxy/lib/index.js:149-154`),说明它来自
**另一次启用了代理的 DSH 启动**(01:39:29),而不是用户手敲的 alias 原文(alias 只写 `.byted.org`)。
该进程 `PPid=1`、`NODE_USE_ENV_PROXY` **缺失**。

**时间线吻合(可复核)**:`$DSH_HOME/dsh-startup.log` 共三次启动
`01:13:21` / `01:39:11` / `01:58:43`,而该孤儿 lark-cli 起于 **01:39:29** —— 正是 `01:39:11`
那次启动的 Host 拉起的子进程。即 **01:39 那次启动带代理、01:58 那次(当前 Host)不带**。

**两个 `/proc` 读数并列,就是"代理继承是真实发生的、且随启动时刻变化"的直接证据。**

---

## 2. 回环 RPC 直连 —— 通过(实测 + 源码)

### 2.1 实测:故意不可达的代理下,回环仍通

只在**我自己的探测进程**里设代理,不污染 Host:

```bash
# (a) 用与 DSH 同一套 Node fetch 栈请求回环 Host
$ HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
    node -e "const r=await fetch('http://127.0.0.1:3080/',{redirect:'manual',headers:{host:'127.0.0.1:3080'}});console.log(r.status)"
401                       # 到达了 Host(401=未认证),没有被"不可达代理"挡住
# (b) 对照:同样环境变量下,一个确实遵守代理的客户端会被挡住 —— 证明毒药有效,探针不是空转
$ HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
    curl -s -o /dev/null -w '%{http_code}\n' --max-time 6 http://127.0.0.1:3080/ ; echo "exit=$?"
000
exit=7                    # curl: (7) Failed to connect —— 代理变量对该客户端生效
# (c) 对照:不设代理
$ curl -s -o /dev/null -w '%{http_code}\n' --max-time 6 http://127.0.0.1:3080/
401
```

**判读**:(a) 成功 +(b) 失败 ⇒ 回环路径**不读取代理环境变量**,是直连;
若回环走了代理,(a) 会像 (b) 一样连不上。

### 2.2 `no_proxy` 是否含回环:本机**整个变量都不存在**,但源码**无条件兜底**

```bash
$ tr '\0' '\n' < /proc/2308857/environ | grep -ic 'no_proxy'
0
```

即本机 **没有** `no_proxy` 可供依赖;回环直连**不是**靠这个变量实现的。

### 2.3 源码位置(部署物 `@deepseek-ai/dsh-http-proxy`)

```js
// lib/index.js:275-280  proxyForUrl —— 回环在任何代理匹配之前直接返回"不代理"
if (isLoopbackHost(url.hostname)) return void 0;
// :200-207  isLoopbackHost:localhost、*.localhost、::1、::、0.0.0.0、整个 127.0.0.0/8、IPv4-mapped 写法
// :149-154  withLoopback —— 发布给子进程的 no_proxy 无条件并入
//           LOOPBACK_NO_PROXY = ["localhost","127.0.0.1","::1","[::1]"]  (:19-24)
```

README 也把它写成设计意图:

> "**Loopback is always bypassed** — `localhost`, the whole `127.0.0.0/8` range, `::1`, `0.0.0.0`,
> and the IPv4-mapped spellings of those. **The harness's own Web UI, Connection transport, and every
> local test server would otherwise route through the proxy and loop.**"

⚠ **一处已知不对称(代码证据)**:环境变量读端(`no_proxy`)只拿到上面**四个字面量**,
拿不到 `127.0.0.0/8`;整个网段只在**进程内** `isLoopbackHost` 里匹配。
即"子进程用 `no_proxy` 判断回环"的能力弱于 Host 自己。

**结论:回环 RPC 直连成立**,且是"策略级无条件直连",不依赖 `no_proxy` 是否配好。

---

## 3. 各执行面的代理行为

本部署的七个面对应关系(从 `--dump-config` loader 表 + 部署目录确认):

| 面 | 实现包 | loader 行 |
|---|---|---|
| Geo | `dsh-home-network-model-guard`(自研) | `dsh-home-network-model-guard` |
| subscriptions | `dsh-plugin-subscriptions` | `llm-subscriptions` |
| cost-meter | `dsh-cost-meter` | `cost-meter` |
| web_fetch | `@deepseek-ai/dsh-web-fetch-http` | `web-fetch-http` |
| search | `@deepseek-ai/dsh-web-search-deepseek` | `web-search-deepseek` |
| MCP | `@deepseek-ai/dsh-mcp-client` | **本 profile 未挂载**(dump 中 `mcp` 命中数 = 0) |
| Pet-lark | `dsh-pet` → 子进程 `lark-cli` | `dsh-pet` |

| 面 | 走代理吗 | 由谁决定 | 证据 | 性质 |
|---|---|---|---|---|
| **Geo** | 是(有策略时) | 进程环境 → DSH 策略 | `dsh-home-network-model-guard/lib/index.js:40` `new GeoCountrySource(current.geoEndpoints, fetch)`;`lib/geo.js:87` `await fetchImpl(endpoint, { signal })` | **代码证据** |
| **subscriptions** | 是 —— **先吃自己的配置**,无配置才回落到全局 fetch | `~/.dsh/plugins/subscriptions/proxy.json`(0600,可带口令);否则 DSH 策略 | `dsh-plugin-subscriptions/lib/http.js:16` `import { ProxyAgent, fetch as undiciFetch } from 'undici'`;`:333-334` `if (dispatcher === undefined) return fetch(input, init);`;`:42-44` 配置路径 | **代码证据** |
| **cost-meter** | 是(有策略时) | 进程环境 → DSH 策略 | `dsh-cost-meter/lib/net.js:55-56` `fetchWithRetry(..., { fetchImpl = fetch })`;调用点 `lib/index.js` / `gateway-quotas.js` / `coding-plans.js` / `custom-balance.js` / `aliyun-balance.js` | **代码证据** |
| **web_fetch** | 是,且**代理时主动放弃地址钉扎** | 进程环境 → DSH 策略 | `dsh-web-fetch-http/lib/index.js:4` `import { proxyRouteFor }`;`:501-502` `const route = proxyRouteFor(url); if (route.proxied && !isNonPublicIpLiteral(url.hostname)) return await publicHttpNetwork.requestVia(route.dispatcher, …)`;`:192-204` `requestVia` 不另建 dispatcher | **代码证据** |
| **search** | 是(有策略时) | 进程环境 → DSH 策略 | `dsh-web-search-deepseek/lib/index.js:133` `response = await fetch(endpoint, {`(裸全局 fetch) | **代码证据** |
| **MCP** | **按 transport 分叉** | 两者都由进程环境 → DSH 策略 | stdio:`dsh-mcp-client/lib/index.js:28-33` `buildChildEnv → {...scrubbedParentEnv(), ...extra}`;HTTP:`:48` `new StreamableHTTPClientTransport(url, { requestInit: { headers } })` 不传 dispatcher ⇒ 走 SDK 的全局 fetch | **代码证据**;**本 profile 未挂载 ⇒ 无运行证据** |
| **Pet-lark** | 子进程**原样继承 `process.env`**,不发布策略 | 仅环境变量 | `dsh-pet/lib/host/channel/bootstrap.js:115` 与 `channel/subscription.js:103` 均为 `spawn(command, [...args], { stdio: [...] })` —— **四处 spawn 全无 `env:` 选项** ⇒ Node 默认整体继承 | **代码证据 + 运行证据**(§1.2、§5.3) |

### 3.1 唯一"能实测的"一面:Geo(有运行证据)

Host 已缓存了一次真实 Geo 判定,通过回环 RPC 可读(前缀通道的 `method` 只写 endpoint 后缀):

```bash
$ curl -s -b <cookie-jar> -X POST -H 'Host: 127.0.0.1:3080' -H 'content-type: application/json' \
    -d '{"type":"client-request","rpcId":"probe-x","method":"status","payload":{}}' \
    http://127.0.0.1:3080/dsh-home-network-model-guard/status
{"ok":true,"value":{"verdict":"blocked","degraded":false,"country":"CN","source":"primary","sampledAt":1790017893141,
 "config":{"blockedCountries":["CN"],"geoEndpoints":["https://ipinfo.io/json","https://ipwho.is/"],
           "timeoutMs":5000,"ttlMs":300000,"backoffBaseMs":2000,"backoffMaxMs":60000},"configEpoch":"default"}}
```

`source:"primary"` + `degraded:false` ⇒ **主 Geo 端点 `https://ipinfo.io/json` 在当前无代理环境下
真实 HTTPS 取值成功**。这是"Geo 面在 DIRECT 策略下确实能出网"的运行证据;
但**"Geo 在有代理时是否走代理"仍只是代码证据**(本机没有可用的代理可试)。

### 3.2 关于"DSH 自己的站代理配置 vs 进程环境变量"

- **DSH 侧没有站代理配置文件**。`grep -i proxy ~/.dsh/profiles/web/{cordis.yml,cordis.patch.yml,package.json}` = **0** 命中;
  `~/.dsh/settings.yaml` 无 proxy 键;仓库 `dsh.yaml` 无 proxy 字段;`patches/` 只有 `connection-webserver.yml`。
- **只有 `subscriptions` 自带配置**:`~/.dsh/plugins/subscriptions/proxy.json`。
  实测本机 **该文件不存在**:

```bash
$ ls -la ~/.dsh/plugins/subscriptions/
-rw------- auth.json        # 值未读取、未记录
-rw-r--r-- models.json
$ [ -f ~/.dsh/plugins/subscriptions/proxy.json ] && echo yes || echo no
no
```

  ⇒ subscriptions 代理为**关闭**,因此回落到全局 fetch(与其余面同路径)。
- 其余六面统一由**进程环境**决定,即"export 了就全走,没 export 就全直连"。

---

## 4. `.env` 三个"明确结果"

### 4.1 项目 `.env` 不注入 —— 通过(但需精确表述)

**方法**:不猜测,直接调用**部署物里的真实函数** `loadLayeredEnv`(`@deepseek-ai/dsh-app-boot`),
在自己的 `/tmp` 进程里跑差分实验(只影响该临时进程,不碰 Host)。

```js
// /tmp/pkg-probe-dsh/envtest2.mjs
const { loadLayeredEnv } = await import(
  '…/.launcher/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')
const snap = loadLayeredEnv('dsh', process.argv[2], () => {})
console.log(snap.get('FOO'), snap.get('HTTP_PROXY'))   // get() -> {value, source, path}
```

| 用例 | `cwd` / `DSH_HOME` | 文件内容 | 实测结果 |
|---|---|---|---|
| T1 | `/tmp/…/proj` / `/tmp/…/candhome` | `proj/.env`: `HTTP_PROXY=http://127.0.0.1:9` | **REFUSED** → `dsh: /tmp/pkg-probe-dsh/proj/.env sets "HTTP_PROXY", which only the launching environment may set (…); export HTTP_PROXY, or put it in /tmp/pkg-probe-dsh/candhome/.env, which does not travel with a repository` |
| T2 | 同上 | `proj/.env`: `DSH_HOME=/tmp/…/relocated` | **REFUSED** → `… sets "DSH_HOME", …; export DSH_HOME instead of putting it in a .env file` |
| T3 | 同上 | `proj/.env`: `FOO=bar` | **ACCEPTED**;`FOO: source=project-env path=/tmp/pkg-probe-dsh/proj/.env value=bar` |
| T4 | `/tmp/…/empty` / `/tmp/…/candhome` | `candhome/.env`: `HTTP_PROXY=http://127.0.0.1:9` | **ACCEPTED**;`HTTP_PROXY: source=user-env path=/tmp/pkg-probe-dsh/candhome/.env` |
| T5 | 两边都无 `.env` | — | 无新增;`HTTP_PROXY`/`FOO` 均 unset |

**精确结论(勿简化成一句"项目 .env 不注入")**:

- **代理类与引导类名字**:项目 `.env` **不能**设置,且是 **fail-closed 硬拒(抛错)**而不是静默丢弃 ——
  包含 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY`、`DSH_*`/`XDG_*`/`DYLD_*`/`BASH_FUNC_*` 前缀,
  以及 `PATH`/`HOME`/`NODE_OPTIONS`/`LD_PRELOAD`/`GIT_SSH_COMMAND`/`DEEPSEEK_BASE_URL`/`SSL_CERT_FILE` 等一长串
  (`BOOTSTRAP_NAMES` `:948-998`、`BOOTSTRAP_PREFIXES` `:1000-1005`)。
- **普通名字**:项目 `.env` **会被载入**该进程环境(`source=project-env`),这是设计的分层
  (`inherited > 调用目录 .env > $DSH_HOME/.env`,`:1081` 只在 `process.env[name] === undefined` 时写入)。
- **只有 `$DSH_HOME/.env` 可以设那四个代理名**(`HOME_LAYER_PROXY_NAMES` `:1013-1018`,`:1053-1054`
  `if (isHome && proxyName) continue;`);注释写明原因:"*A proxy chooses the route every request takes,
  so the invoking directory's file — which arrives with a clone — keeps refusing them; the home file is
  the user's own*"。匹配走 `toUpperCase()`,故 `https_proxy` 小写**不是**绕过口。
- 校验发生在**任一文件被应用之前**(两个文件先全查、再全部应用),所以"项目 `.env` 里混一个 `HTTP_PROXY`"
  会让**整个启动失败**,不会部分生效。

### 4.2 仓库 launcher 的 `.env.local` 是**另一套机制**(必须分开说)

Host 进程里**确实**有 `DSH_TRAEX_BRIDGE`,且它的值与本仓库 `.env.local` 逐字节相同(哈希比对,值未打印):

```bash
$ sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' <repo>/.env.local | sort -u
DSH_TRAEX_BRIDGE
$ # 文件值 vs /proc/2308857/environ 值
file_sha=<前16位相同>   proc_sha=<前16位相同>   -> SAME_VALUE
```

来源是 **ohmydsh 自己的启动器**,不是 DSH 运行体的 `.env` 分层加载器:

```bash
# <repo>/bin/dsh:51-55
if [[ -f "$REPO/.env.local" ]]; then
  set -a
  source "$REPO/.env.local"
  set +a
fi
```

`.env.local` 文件头也自述:"*ohmydsh 本地环境变量(gitignored;bash 语法,由 bin/dsh 启动器 source)*"。
⇒ 这是**本仓库声明的 env gate 特性**,与"项目 `.env` 是否被运行体注入"是**两个不同的面**,不可混记。
除 `DSH_TRAEX_BRIDGE` 外,Host 环境中**没有**任何该文件以外的项目键。

### 4.3 候选不读生产 `$DSH_HOME/.env` —— 结构成立,正例无法构造

- 读取路径由 **`resolveDshHome()`** 决定 = `configured ?? 非空 trim 的 $DSH_HOME ?? ~/.dsh`
  (`@deepseek-ai/dsh-home-paths/lib/index.js:73-76`),而 `DSH_HOME` 本身是**引导类名字**——
  项目 `.env` 改不动它(T2 已证),所以"home 层文件"无法被 `.env` 重定向。
- 实测:`DSH_HOME=/tmp/pkg-probe-dsh/candhome` 时 `resolveDshHome() = /tmp/pkg-probe-dsh/candhome`,
  且快照记录的 home 层来源就是 `source=user-env path=/tmp/pkg-probe-dsh/candhome/.env` ——
  **没有**去读 `/home/zhangyong.617/.dsh/.env`。
- ⚠ **运行时里不存在 "candidate home" 概念**:只有一个 `resolveDshHome()`;
  `dshHomeDisplay` 只挑显示标签,不换 home。
- ⚠ **正例无法构造**:devbox 上生产 `$DSH_HOME/.env` **不存在**:

```bash
$ ls -la /home/zhangyong.617/.dsh/.env
ls: cannot access '/home/zhangyong.617/.dsh/.env': No such file or directory
```

  ⇒ 无法做"生产 home 里放一个可辨识键 + 候选启动后确认没读到"的实证。**如实记录为无法构造正例**,
  只能给上述路径级证据(读的是 `resolveDshHome()`,且实测读到了候选 home 的文件)。

---

## 5. child / workflow / code-runtime 的继承差异 —— 有明确结果,三者互不相同

| 执行面 | 是否继承 Host 代理环境变量 | 实测/源码 |
|---|---|---|
| **subprocess 缝(可执行子进程、bash 工具 / code-runtime 的常规执行)** | **继承"解析后的策略"(不是原样拷贝)** | `dsh-subprocess/lib/index.js:50-56` `scrubbedParentEnv()`:父 `process.env` 减去 `/KEY\|PASSWORD\|SECRET\|TOKEN/i`、减去全部 `DSH_*`,**再叠加** `proxyEnvironmentForChild()`;`dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:649-650` `childEnv()` 用它作基 |
| **workflow worker thread** | **完全不继承(刻意)** | `dsh-workflow-worker-thread/lib/index.js:205-214` `workerSpawnEnv()` `const env = {};` 只加 win32 的 `TMP`/`TEMP`(未构建时加 `TSX_TSCONFIG_PATH`),`:229`/`:247` 作为 `env:` 使用;`:189-193` 注释:"*deliberately no proxy policy. A worker thread does not inherit the host's global dispatcher, so a workflow's own requests go direct — the alternative is handing the worker a proxy URL that may carry `user:password`, and this worker executes the model-authored script body.*" |
| **code-runtime worker thread** | **完全不继承** | `dsh-code-runtime-worker-thread/lib/index.js:747` `env: {},` |
| **MCP stdio 子进程** | 继承解析后的策略 | `dsh-mcp-client/lib/index.js:28-33` `buildChildEnv(extra) = { ...scrubbedParentEnv(), ...extra }` |
| **Pet-lark 子进程(`lark-cli`)** | **原样全量继承(不裁剪、不发布策略)** | 代码:四处 spawn 均无 `env:`(`dsh-pet/lib/host/channel/bootstrap.js:115`、`subscription.js:103`、`media.js:214-218`、`lark.js:18`)⇒ Node 默认 = 完整 `process.env`;运行证据见下 |

### 5.1 关键差异:同样是"子进程",行为完全不同

- 走 **subprocess 缝** 的子进程:**代理变量按策略重写**、且 `DSH_*` 与凭据类名字被**抹掉**;
  有策略时还会加 `NODE_USE_ENV_PROXY=1`(`dsh-http-proxy/lib/index.js:495`)。
- 走 **worker thread** 的两处:**连 `env` 都不给**,代理知识为零(安全取向,注释已说明)。
- 走 **dsh-pet 自己的 `node:child_process.spawn`**:**绕过了整条缝**,既不裁剪也不发布。

也就是说 **"子进程是否继承代理"没有单一答案** —— 取决于它是否经由 `ctx.subprocess`。

### 5.2 Pet-lark 的运行证据(实测)

本轮 Host 的**唯一子进程**就是 lark-cli:

```bash
$ ps -eo pid=,ppid=,args= | awk '$2==2308857'
2309290 2308857 node /usr/bin/lark-cli --profile dsh-pet event consume im.message.receive_v1 --as bot
$ tr '\0' '\n' < /proc/2309290/environ | wc -l          # 22
$ tr '\0' '\n' < /proc/2309290/environ | grep -ic proxy  # 0
$ comm -23 host.keys child.keys   # host-only
(空)
$ comm -13 host.keys child.keys   # child-only
VIPSHOME
```

- 子进程环境 = Host 环境的**全量副本**(22 个键;唯一差异是子进程多一个 `VIPSHOME`),**没有任何裁剪**:
  `DSH_HOME`、`DSH_TRAEX_BRIDGE` 都在 ⇒ **`DSH_*` 没有按 `scrubbedParentEnv` 的规则被抹掉**,
  证实它没走那条缝。
- 代理变量 **0**(因为 Host 本身 0,无可继承)。**"Pet-lark 在有代理的 Host 下会不会经代理"因此在本机
  无法直接验证**;但 §1.2 的孤儿 `lark-cli`(2300412)带着完整代理串,**说明答案是"会原样继承"**。

### 5.3 `lark-cli` 自身是否真的使用这些变量 —— **未验证**

`@larksuite/cli` 的传输实现(axios 式 env 代理 vs undici vs 自定义)未查明;
`/usr/lib/node_modules/@larksuite/cli/package.json` 中未见 axios/proxy-from-env/node-fetch/undici 依赖命中,
未继续追。**"Pet-lark 继承代理环境变量"已证;"它据此真的走代理"未证。**

---

## 6. 报告不含代理凭据 —— 通过(自检)

```bash
$ grep -nEi 'proxy' <本文件> | sed -E 's#(//)[^@/ ]+@#\1<REDACTED>@#'
# 出现的代理串只有 http://sys-proxy-rd-relay.byted.org:8118 —— 该 URL 无 userinfo
$ grep -nEi 'token=|cookie|authorization|bearer|BEGIN [A-Z ]*PRIVATE KEY' <本文件>
# 无匹配
```

- 全文**无** `user:password@` 形式的代理凭据;**无** token、cookie 值、`Authorization` 头。
- 探测期间从 `dsh.log` 取过的 launch token **只用于发请求**,未落盘到本文件或任何证据文件。
- `~/.dsh/plugins/subscriptions/auth.json`(0600)**未读取其内容**。

---

## 仍未验证清单(8.4)

1. **有代理时的实测行为(全部七面)** —— 本机 Host 无代理(0 变量)、`subscriptions/proxy.json` 不存在,
   因此**无法对任何一面做"经代理"的正向运行验证**;§3 除 Geo 的 DIRECT 成功外**全是代码证据**。
   要做需要一次人工 `set_sh_devbox_proxy` 后启动的专门验收(会触及"不重启 Host"约束,本轮未做)。
2. **`lark-cli` 是否真的使用继承到的代理变量**(§5.3)。
3. **Geo 在有代理时是否确实经代理** —— 代码是把裸全局 `fetch` 交给 `GeoCountrySource`,
   机制上应被 `setGlobalDispatcher` 路由,但未运行追踪。
4. **`.env` 层的"候选 vs 生产"** —— 运行时不存在 candidate home 概念,生产 `$DSH_HOME/.env` 也不存在,
   正例**无法构造**(§4.3)。
5. **项目 `.env` 的普通名字进入 Agent/子进程执行面后的可见性** —— 本轮只测到"进入 `loadLayeredEnv`
   返回的进程环境";未验证它是否进一步流入各执行面(那需要真实会话/tool 调用)。
6. **`verify-no-bare-dispatcher` 门禁** —— 源码存在但未执行(本轮不跑仓库脚本)。
7. **`web_fetch` 代理时"放弃地址钉扎"的安全后果** —— 已定位代码(`:501-502`),未做安全评估。
8. **`clearedProxyEnv` 无运行时消费者** —— 只被测试/fixture 使用,未构造用例。

## 环境与不变量核对

- Host pid **2308857**,`Tue Sep 22 01:58:43 2026` 启动,`127.0.0.1:3080`;未触碰 pid **1285260**(端口 3081)。
- `dshVersion=0.1.5-rc.2`(`dsh-startup.log` 末行),Node `v22.23.2`。
- Pet 数据不变量:探测前后均为 `loci=1 deliveries=1 tasks=2 invocations=1 channel_config=1`。
- devbox 上未重启 Host、未改 `dsh.yaml`、未跑 `dsh build`;临时文件只在 `/tmp/pkg-probe-dsh/**`。
