# 任务 8.3:RPC Host fence 与 Web 文件授权(devbox 实测)

被测对象:devbox `n37-044-026`,Host pid **2308857**,端口 **3080**,`$DSH_HOME=/home/zhangyong.617/.dsh`,
运行体 `dshVersion=0.1.5-rc.2`(`dsh-startup.log` 末行 `2026-09-22T01:58:43+0800`),Node `v22.23.2`。
本轮为**只读探测**:未重启 Host、未改 `dsh.yaml`、未跑 `dsh build`;写入仅限 devbox `/tmp/pkg-probe-dsh/**`。

## 结论

1. **Host fence 真实存在且先于认证判定**:四格矩阵为
   `合法 Host+已认证=200` / `合法 Host+未认证=401` / `伪造 Host+已认证=403` / `伪造 Host+未认证=403`。
   伪造 Host 无论带不带凭据都是 **403**,证明 fence 在认证**之前**执行——
   这正是"Host 被拒"与"未认证"必须分开记录的原因(401 ≠ fence)。
2. **fence 覆盖三个独立维度**,不只是 Host 头:DNS-rebinding(`127.0.0.1.nip.io`→403)、
   `sec-fetch-site: cross-site`(→403)、`Origin` 与 Host 不一致(→403)。逻辑全部在
   `requestRejection()` 一处,`/api` 通道与各 prefix 通道共用。
3. **Session 绑定真实生效**:同一相对路径 `README.md` 在三个不同 Session 身份下解析到
   **三个不同的绝对路径**(`workspaceFiles/stat` 实测),证明 Host 只认**线上传来的 Session**,
   不借用任何"当前会话/标签页"。不存在的 Session 被拒(`gateway/lookup-not-found`)。
4. **cold Session 是"能解析"而非"被拒"** —— 与任务书措辞不同,但与 change design 一致
   (design.md:"cold Session 能从 persistence header 定位而不激活 Agent")。实测 cold Session
   经 persistence header 正常解析到自己的 workspace root。
5. **workspace-files read 走 composed fs policy,不是普适 workspace containment**——
   这是本轮最清晰的一组差异:workspace **之外**的 `/etc/hostname` 用 `read`/`readAll`/`readBytes`/
   `readRelated` **全部可读**;只有 `list` 对 workspace 外路径返回
   `workspace-file/outside-workspace`。
6. **file-upload receipt(真正的 "receipt")未能做正向运行时验证** —— 铸造 receipt 需要把字节写进
   真实 Session 的 attachment 存储,超出"只读探测"约束。该面为**代码证据**,已精确标注(见 §4)。

通过/未通过/未验证三态见每节标题。

---

## 1. Host fence 四格矩阵 —— 通过(实测)

**第一步必须先拿到"合法会话"**,否则四格里的"带凭据"一列根本构造不出来,会把 401 误读成 fence。
本 runtime 的浏览器会话是 **loopback 专属的 token 换 cookie**:`GET /?token=<launch token>` 返回 `303`,
`set-cookie` 后凭 cookie 访问。token 从 `$DSH_HOME/dsh.log` 的 `dsh web: http://127.0.0.1:3080/?token=…`
行取(仅用于发请求,未写入本文件)。

```bash
TOKEN=$(sed -n '724p' ~/.dsh/dsh.log | sed -E 's#.*token=##')
curl -s -D - -o /dev/null -c /tmp/pkg-probe-dsh/cj.txt \
     -H 'Host: 127.0.0.1:3080' "http://127.0.0.1:3080/?token=$TOKEN"
# -> HTTP/1.1 303 See Other ; location: / ; set-cookie: dsh-auth-<sha256(authority)>… (值已脱敏)
```

探针路径 `POST /api/workspaceFiles/stat`(合法 RPC,见 §3 信封)。结果:

| Host 头 | 带有效会话 cookie | 不带凭据 |
|---|---|---|
| `127.0.0.1:3080`(合法回环) | **200** | **401** |
| `evil.example.com`(伪造) | **403** | **403** |

**判读**:伪造 Host 两格都停在 **403**,与是否携带凭据无关 → fence 先判、认证后判;
合法 Host + 无凭据是 **401** → 这两者语义不同,不可混记。

### 1.1 fence 的其余维度(同一 `/api/workspaceFiles/stat` 探针,均带有效 cookie)

| 请求特征 | 状态码 | 含义 |
|---|---|---|
| `Host: 127.0.0.1:3080` | **200** | 基线 |
| `Host: 127.0.0.1.nip.io:3080` | **403** | DNS-rebinding 防护命中(`isTrustedAuthority` 拒绝非回环域名) |
| `Host: 127.0.0.1:3080` + `sec-fetch-site: cross-site` | **403** | 跨站 fetch 被拒 |
| `Host: 127.0.0.1:3080` + `Origin: http://evil.example.com` | **403** | Origin 与 Host 不同源 |
| `Host: 127.0.0.1:3080` + `Origin: http://127.0.0.1:3080` | **200** | 同源放行 |
| 完全不带 `Host` 头(`curl -H 'Host;'`) | **403** | 无 authority 即拒 |
| `Host: localhost:3080` | **401** | fence **放行**(回环主机名),但 cookie 绑定的 authority 不同 → 认证失败 |
| `Host: [::1]:3080` | **401** | 同上 |
| `Host: 127.0.0.1:9999`(端口不符) | **401** | 同上 |
| `Host: evil.example.com` | **403** | 对照:伪造 → fence |

⚠ **`localhost` 那一格是 401 而不是 403,容易被再次误读。** 原因已从代码确认:
cookie **名**就是 authority 的哈希(`cookieName(authority) = COOKIE_PREFIX + base64url(sha256(authority))`),
所以发给 `localhost:3080` 的请求找不到它为 `127.0.0.1:3080` 铸造的 cookie。
`localhost`/`[::1]`/`127.0.0.1:9999` 三格都是 **fence 通过、认证拒绝**——恰好是"401=fence 已放行"的正面证据。

**源码位置**:`.../.launcher/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js`

```js
// :201
function isTrustedApiRequest(request, trustedHosts) {
  const host = header(request.headers, "host");
  if (host === void 0) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === void 0) return false;
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
  const origin = header(request.headers, "origin");
  if (origin === void 0) return true;
  try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}
// :553  —— 唯一的判定入口,先 fence 后认证
requestRejection(request) {
  if (!isTrustedApiRequest(request, this.trustedHosts)) return 403;
  return this.browserAuth.isAuthenticated(request) ? void 0 : 401;
}
```

filter 的两处调用点:`:609`(prefix channel,`register()`)与 `:772`(`/api` 共享通道),
故 `/api` 与各通道 fence 一致。

### 1.2 `/api` 404 与 405 语义不同(顺带确认)

- `GET /api/workspaceFiles/stat` → **404**(共享 handler 里"该 endpoint 无此 method / 非 typert endpoint")
- `POST /definitely-not-a-real-path-xyz` → **405**(无此 POST 路由)
- `GET /definitely-not-a-real-path-xyz` → **404**
- `POST /api/session/uploadFileBinary`(GET)→ **404**

即任务书里"405=没有这条 POST 路由"与"`/api` 下 404 来自 channel 处理器"两点在本机复现一致。

---

## 2. 文件授权 RPC 面(读部署物确认)

`dsh --profile web --dump-config`(用 launcher 的 `node bin.js`,PATH 里无 `dsh`)给出 loader 表,
实测共 **172** 条 `- id:` 行(其中含本仓库自研与远端定制行,如 `dsh-pet`、`dsh-cost-meter`、
`llm-subscriptions`、`dsh-home-network-model-guard` 等)。
文件读取面**不在** `connection.rpc.handle()` 前缀通道里,而是走 **Typert Gateway 的 `/api` 共享通道**:

```yaml
# dump.yaml:551 附近
- id: cost-meter
  name: dsh-cost-meter
# 官方行中与本任务相关:
- id: web-fetch-http
  name: '@deepseek-ai/dsh-web-fetch-http'
```

| 面 | 包 | 通道/端点 |
|---|---|---|
| 文件预览读 | `@deepseek-ai/dsh-api-workspace-files` | `/api` + endpoint `workspaceFiles/stat`、`workspaceFiles/read`、`workspaceFiles/readBytes`、`workspaceFiles/readAll`、`workspaceFiles/readRelated`、`workspaceFiles/list`、`workspaceFiles/changes` |
| 上传 receipt | `@deepseek-ai/dsh-client-file-upload` | **独立精确路由** `POST /api/session/uploadFileBinary`(`connection.fetch.register`,流式 body) |

### 2.1 `/api` 通道的信封与命名(实测确定)

与任务书给的形态一致,但有两处易错点:

- **endpoint 用 `/` 而不是 `.`**:`endpointOf(namespace, method) = \`${namespace}/${method}\``
  (`dsh-api-gateway/lib/index.js:990`)。路径 = `/api/workspaceFiles/stat`。
- **`payload.args` 是"具名参数对象",不是位置数组**;`method` 必须**逐字等于** endpoint 字符串,
  否则返回 `gateway/bad-request`(实测:`method:"/dsh-system-clock/now"` 被拒,提示
  `does not match endpoint "now"`)。

```bash
# 实测可用的信封
curl -s -b /tmp/pkg-probe-dsh/cj.txt -X POST -H 'Host: 127.0.0.1:3080' \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"probe-1","method":"workspaceFiles/stat",
       "payload":{"args":{"workspaceFileScopeId":"<sid>","path":"README.md"}}}' \
  http://127.0.0.1:3080/api/workspaceFiles/stat
```

前缀通道(`/dsh-system-clock/now`)**相反**:`method` 只写 **endpoint 后缀**(`now`),写全路径被拒。

**Session 句柄的线格式**:方法签名的第一个形参 `workspaceFileScope: WorkspaceFileScope` 是 typert
**lookup**,注册为 `{parameter:'workspaceFileScope', wire:'workspaceFileScopeId',
wireTypeSymbol:'…dsh-session/types#SessionId'}`(`dsh-api-workspace-files/lib/index.js:373`),
所以线上传的就是**裸 SessionId 字符串**——authorizing Session 本身就是句柄,不存在第二个可分离的 token。

---

## 3. receipt ↔ Session 绑定 —— 部分通过 / 部分未验证

### 3.1 活/冷判定依据(可复核)

用 **Host 是否持有 `session.lock`** 判定 live:

```bash
ls -l /proc/2308857/fd | grep -oE 'sessions/[^ ]*' | sort -u
# sessions/--…-corp-nexus--/session-2a4eeb71-…/session.lock
# sessions/--…-corp-nexus--/session-816f8844-…/session.lock
# sessions/--…-opensource-ohmydsh--/session-17e56eeb-…/session.lock
# sessions/--tmp-wt-fixture-repo--/session-e6bcb6b5-…/session.lock
# sessions/--tmp-wt-fixture-repo--/session-f87511f4-…/session.lock
```

本次使用的三个身份:

| 代号 | SessionId | workspace root | 判定 |
|---|---|---|---|
| A | `session-17e56eeb-3696-45b2-9b9b-dd8f52e76979` | `/data00/home/zhangyong.617/opensource/ohmydsh` | **LIVE**(fd 中 `session.lock` 计数 = 1) |
| B | `session-2bd8282f-d483-4e13-b42e-0c73f04a5c06` | `/data00/home/zhangyong.617/learning`(空目录) | **COLD**(计数 = 0) |
| C | `session-c9136c7b-8b02-444b-b289-204b1112b83c` | `/data00/home/zhangyong.617/dev-infra-server` | **COLD**(不在 fd 列表) |
| X | `session-00000000-0000-4000-8000-000000000000` | — | 不存在 |

### 3.2 四情形实测(`workspaceFiles/stat`,HTTP 一律 200)

| 情形 | 请求 | 判定 |
|---|---|---|
| **正向(合法 LIVE Session)** | `{sid:A, path:"README.md"}` | ✅ `ok:true` `absolutePath=/data00/home/zhangyong.617/opensource/ohmydsh/README.md` `bytes:17407` |
| **cold Session** | `{sid:B, path:"README.md"}` | ✅ **解析成功**(root 解析为 B 的空 learning 目录),故返回业务错误 `workspace-file/not-found` `no entry at "README.md"` —— **不是授权拒绝** |
| **cold Session(再证)** | `{sid:C, path:"README.md"}` | ✅ `ok:true` `absolutePath=/data00/home/zhangyong.617/dev-infra-server/README.md` `bytes:4303` |
| **不存在的 Session** | `{sid:X, path:"README.md"}` | ✅ **被拒** `gateway/lookup-not-found` `lookup provider "workspaceFileScope" did not resolve the requested identity` `details.field="workspaceFileScopeId"` |

> ⚠ **与任务书措辞的差异,必须写清**:任务书写"cold Session → 应拒绝"。
> 0.1.5 的实现与 change design 都把 cold Session 当**支持**的能力(persistence header 定位,
> 不激活 Agent)。本轮实测支持后者。**被拒的是"不存在的 Session"**,不是"cold Session"。

### 3.3 不借用当前/标签页 Session —— 通过(实测)

同一相对路径在三个身份下解析到三个不同绝对路径:

| 身份 | `path:"README.md"` 解析结果 |
|---|---|
| A (LIVE, ohmydsh) | `/data00/home/zhangyong.617/opensource/ohmydsh/README.md` |
| B (COLD, learning) | workspace root = `…/learning` → `workspace-file/not-found` |
| C (COLD, dev-infra-server) | `/data00/home/zhangyong.617/dev-infra-server/README.md` |

根由**线上 SessionId**决定,与调用方"当前会话"无关 → "精确绑定 Session、不借权"在本层成立。

**resource address 层(代码证据,非运行证据)**:`dsh-api-workspace-files/lib/client.js:408` 的
`resolve(address)` 是地址的**纯函数**——只有两个出口,要么取地址里的 SessionId,要么
`unknownWorkspace(address)`;函数体内**没有任何** "当前 Session / Tab Session" 的访问路径:

```js
if (parsed.scope === "session") return { ok: true, value: { sessionId: parsed.sessionId, path: parsed.path } };
return { ok: false, error: unknownWorkspace(address) };   // dsh-resource://file/absolute/<path>
// -> RemoteError("workspace-file/unknown-workspace", "… requires a dsh-resource://file/session/<sessionId>/<path> address")
```

该错误码是**浏览器端**地址解析失败,不经 HTTP,devbox 上无浏览器自动化,故为**未验证(客户端面)**。

### 3.4 真正的 "receipt"(`file-upload`)—— 运行时未验证 / 代码证据充分

任务书与 design.md 里的 "receipt" 指 `@deepseek-ai/dsh-client-file-upload` 铸造的**不透明上传凭据**。
其实现在 `.../dsh-client-file-upload/lib/index.js`:

```js
// :164  receipt 表以「接收 Agent 的 Session 对象」为键
stagedFiles = new WeakMap();
// :228  resolve(agent, receiptId) —— 外来 receipt 落空
resolve(agent, receiptId) {
  this.assertAgentScope(agent);
  return this.stagedFiles.get(agent.session)?.get(receiptId)?.file;   // 外来 -> undefined
}
// :243  bindPrompt —— 不在本 Session 暂存表里就抛
const upload = staged.get(receiptId);
if (upload === void 0) throw fileNotStaged();
//   fileNotStaged() -> RemoteError("session/attachment-invalid", "File was not uploaded for this session.",
//                                  { reason: "FILE_NOT_STAGED" })
// :273  commit() —— 存储完成后再次核对 Agent 身份
if (this.ctx.agents.get(agent.id) !== agent)
  throw new RemoteError("session/not-found", `session "${agent.id}" was disposed before its file upload completed`, …);
```

READEME 把它写成不变量:*"**Each upload receipt belongs to one exact Session**, and each request uses one
selected carrier."*;`stagedFiles` 的 `WeakMap<Session, Map<receiptId, upload>>` 结构即该不变量的实现,
跨 Session 复用结构性落空(`undefined`)而非"校验后拒绝"。

**能做的运行时探针(不铸造 receipt、不产生写入)已做尽** —— 全部在 `resolveAgent()` 之前失败:

| 探针 | 结果 |
|---|---|
| `POST /api/session/uploadFileBinary` 不带 `sessionId` | **400** `sessionId is required` |
| 同路由 `content-type: text/plain` | **415**(实测状态码;响应体文案取自源码 `content type must be application/octet-stream`) |
| 同路由 `GET` | **404**(无 POST 路由) |
| 不存在的 `sessionId` + `octet-stream` | **200** `{"ok":false,"error":{"code":"session/not-found","message":"session \"session-000…000\" not found","details":{"sessionId":"…"}}}` |
| 同上但 `Host: evil.example.com` | **403**(fence) |
| 同上但不带 cookie | **401**(认证) |

**未验证项(明确)**:receipt 的**正向铸造**、**cold/wrong Session 复用同一 receipt 被拒**这两条
需要把字节写入真实 Session 的 attachment 存储(会把 Session 预热/resume,属写操作),
本轮"只读探测"约束下**未执行**,仅上表负例 + 上述代码证据可用。
建议在允许写的一次专门验收里补「A 取 receipt → B 的 Agent 复用 → 期望 `FILE_NOT_STAGED`」。

### 3.5 未伤数据的证据

探针前后各查一次 Pet 数据不变量(`u_dsh_pet_*` 表,devbox `-wal` 模式下用 `node:sqlite` 打开 DB 副本):

```
PET_INVARIANTS loci=1 deliveries=1 tasks=2 invocations=1 channel_config=1   （探测前）
PET_INVARIANTS loci=1 deliveries=1 tasks=2 invocations=1 channel_config=1   （探测后）
```

上传路由负例探测前后 `find $DSH_HOME/sessions -maxdepth 2 -name 'session-*' -type d` 的排序快照
`diff` 为空 → **无新 Session 目录、无 Session 状态变更**。

---

## 4. workspace-files read 的 fs policy —— 通过(实测,差异清晰)

### 4.1 实测矩阵(身份 A,LIVE;HTTP 一律 200,状态在信封 `result` 里)

| 操作 | 路径 | 与 workspace 的关系 | 结果 |
|---|---|---|---|
| `read` | `/etc/hostname` | **外** | ✅ `ok:true` `text:"n37-044-026"` `lines:1` `eof:true` |
| `readAll` | `/etc/hostname` | **外** | ✅ `ok:true` `data:"bjM3LTA0NC0wMjYK"`(base64"n37-044-026") |
| `readBytes` | `/etc/hostname` | **外** | ✅ `ok:true` 同上 |
| `readRelated` | base `/etc/hostname` + `relativePath:"hosts"` | **外→外** | ✅ `ok:true` `absolutePath:"/etc/hosts"` `bytes:297` |
| `stat` | `/etc/hostname` | **外** | ✅ `ok:true` `bytes:12` |
| `stat` | `/data00/home/zhangyong.617/.dsh/AGENTS.md` | **外** | ✅ `ok:true` `bytes:1125` |
| `read` | `/etc/shadow` | **外** | ❌ `ok:false` `gateway/internal` `EACCES: permission denied, open '/etc/shadow'`(**OS 权限**,非 DSH 策略) |
| `list` | `/etc` | **外** | ❌ `ok:false` `workspace-file/outside-workspace` `"/etc" is outside the workspace` |
| `list` | `/data00/home/zhangyong.617/.dsh` | **外** | ❌ `ok:false` `workspace-file/outside-workspace`(同上) |
| `list` | `.` | **内** | ✅ `ok:true`(返回 repo 根 2000 条上限内的真实条目) |
| `read` | `README.md` | **内** | ✅ `ok:true` `absolutePath=…/opensource/ohmydsh/README.md` |

### 4.2 这组结果为什么证明"composed fs policy"而不是"普适 workspace containment"

- 若把 `workspaceRoot` 当作普适边界,**上面 6 条 workspace 外读全部应是拒绝**;实测全部成功。
  唯一的拒绝来自**操作系统 read authority**(`/etc/shadow` 的 `EACCES`),而它恰恰证明
  读路径用的是 `ctx.fs` 后端的权限,而不是 DSH 自己的目录围栏。
- **同一个 workspace 外的路径** `/etc`:`list` 拒绝、`read`(对 `/etc/hostname`)放行
  —— 同一实现内两条不同的策略面,方向相反,这是"按操作分别授权"而非"统一 containment"的**直接反证**。
- 单向可读 + 单向受限的组合无法由"朴素 containment"解释,只能由"读=composed fs read policy;
  containment 只作用于 directory listing 与变更观察"解释。

**源码位置**(部署物 `@deepseek-ai/dsh-api-workspace-files/lib/index.js`):

```js
// README.md「Addressing and paths」
// "The composed filesystem decides whether the path is readable; the service does not impose
//  workspace containment on file reads." / "list remains workspace-scoped"
// README.md「File-read and directory checks」
// "File operations then resolve and read through the composed filesystem without an additional
//  workspace-containment check. `list` alone requires the resolved directory to remain inside the workspace root."
// README.md「Design concept」
// "Reads through ctx.fs use the backend's read authority; the sandboxing backend fences writes and edits,
//  not reads. … workspace containment belongs only to directory listing and change observation."
```

`list` 的 containment 错误码为 `workspace-file/outside-workspace`(README「Failures」表中标注
*directory listing only*)——与实测一致。

### 4.3 未验证

- **`list`/`changes` 的 workspace 内行为边界**(如 symlink 越界、`..` 穿越)未逐项探测;
  已知实现先用 `lstat` 拒绝最终 symlink,本轮未验证。
- **composed policy 中"额外允许根 / 拒绝规则"的配置面**:本部署的 `sandbox-policy` 行未声明
  workspace 之外的额外根,因此**没有构造出"策略允许的 workspace 外路径"与"OS 允许"这两种原因的分离**;
  实测的 workspace 外可读只能归因到 `ctx.fs` 读权限。**这是一个口径限制,不是通过。**
- `changes` 流式订阅未探测(需长连接,且只观察 workspace 内)。

---

## 仍未验证清单(8.3)

1. **file-upload receipt 的运行时正向铸造**与 **cold/wrong Session 复用同一 receipt 被拒** ——
   需要写 attachment 存储,超出只读探测约束(§3.4)。
2. **resource address(`dsh-resource://file/absolute/<path>` → `workspace-file/unknown-workspace`)**
   —— 客户端纯函数,devbox 无浏览器自动化(§3.3)。
3. **trustedHosts 白名单的 LAN 字面量放行** —— 本机只探了回环与伪造域名,未构造
   `ctx.webRuntime.trustedHosts` 中的部署派生 LAN 地址(需要另一台机器发起请求)。
4. **`list` 的 containment 绕过尝试**(symlink / `..` / 相对路径拼装)—— 未逐项探测(§4.3)。
5. **workspace-files 的 `changes` 流**与 `maxLines`/`maxBytes`/`maxEntries` 上限拒绝路径 —— 未探测。
6. **`/api` 通道的 415/400/500 分支** —— 只顺带看到 404/405,未逐分支构造。

## 环境与不变量核对

- `ps -o lstart= -p 2308857` → `Tue Sep 22 01:58:43 2026`;`ss -ltnp` → `127.0.0.1:3080` 属 pid 2308857。
- `tail -1 $DSH_HOME/dsh-startup.log` → `dshVersion=0.1.5-rc.2 … port=3080 plugins=[]`。
- 未触碰 pid 1285260(端口 3081)。
- Pet 数据不变量探测前后一致(§3.5)。
- 本文件不含 token / cookie 值 / 代理凭据。
