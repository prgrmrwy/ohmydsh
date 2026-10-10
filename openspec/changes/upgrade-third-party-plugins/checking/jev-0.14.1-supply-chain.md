# T2 — 审计 `@jkudish/jev-mcp` 0.6.0 → 0.14.1 新增的未受 pin 传递依赖 `@jkudish/jev-agent-tools`

- 审计者：`jev-auditor`（shared task `task-2`）
- 执行目录：`/Users/prgrmrwy/opensource/ohmydsh/.worktrees/task-459f2f50d0`
- 审计时间：2026-10-10
- 约束遵守情况：只读。未 `npm install`，未执行任何被审包代码（仅 `npm view` 元数据 + `curl` 下载 tarball + 人工阅读反编译产物 + 自写 `node -e` 读本地文件）。全部落盘只发生在 `.tmp-audit/jev/`。未修改任何受版本控制文件。
- 注意：`.tmp-audit/` **未**被 `.gitignore` 覆盖（`.gitignore` 只有 `.tmp-old-blackbox/`），所以它是 untracked 而非 ignored。本轮未改 `.gitignore`（属受版本控制文件，超出授权）。收尾时若需保持 `git status` 干净，请由 Lead 决定是否清理该目录。

## 0. 结论速览

| # | 问题 | 结论 |
|---|---|---|
| 1 | `^0.2.0` 解析到哪、可变性 | 当前解析到 **0.2.0**（唯一 0.2.x，`latest` 也是 0.2.0）；已发布产物不可变，但**解析结果浮动**：任何未来的 0.2.x 发布都会静默改变全新安装的结果 |
| 2 | 能力面 | **零运行时依赖、无 install 钩子、无 `child_process`、无任何文件 I/O**；出站域名 4 个（另 1 个仅 header 常量）；凭据只经注入的 `env` 读取并以 `Authorization: Bearer` 发出；无密钥落日志证据 |
| 3 | 只设 `TYPESAFE_API_KEY` 是否**确定**走 TypeSafe | **是，确定**（静态可判定）。仓库 launcher 硬编码 `JEV_PROVIDER=typesafe` 且 `spawn` 的 `env` 是**替换而非合并**，两条独立路径都收敛到 typesafe |
| 4 | 仓库工具能否发现该浮动依赖漂移 | **不能**，且是代码结构性的：`plugin-updates.mjs` 从不请求 `dependencies` 字段；`third-party-resources.mjs` 只校验已声明的三元组 |
| 5 | 升级三元组 | `spec: '@jkudish/jev-mcp@0.14.1'`、`version: 0.14.1`、`integrity: sha512-HGG0NyKGdGBTyIUsrxXdf3Da0rVBk0YM2p8zDRcZXnbAxaa/EOC9vFWgD5/snVz0K0NiSmz1eMh/aahbxPoQ7w==`；`bridge`/`serverName`/`credentialEnv`/`toolCallTimeoutMs` **全部不需要改** |

Go/No-Go：**GO**（有 3 条残留风险，见 §7；其中最主要的是"未做真实调用握手"，建议安装后补一次真实 `jev_classify`）。

---

## 1. Q1 — `@jkudish/jev-agent-tools` 版本、integrity、解析与可变性

证据命令（全部只读）：

```bash
npm view @jkudish/jev-agent-tools --json
npm view @jkudish/jev-agent-tools dist-tags --json
npm view @jkudish/jev-agent-tools versions --json
npm view @jkudish/jev-agent-tools@<v> dist.integrity --json   # 逐版本
```

### 1.1 dist-tags

```json
{ "latest": "0.2.0" }
```

### 1.2 全部版本与每版 `dist.integrity`

| version | `dist.integrity` | 发布时间 (registry `time`) |
|---|---|---|
| 0.1.0 | `sha512-Sjiaj/U4J4XqrXQMzI14DWlPAb3h1b+kgVwhnMSlvvtp13c+T7NjZCqYLa4LipGDK0iE6bh1AenZIbj+9qhj4g==` | 2026-09-24T02:59:58Z |
| 0.1.1 | `sha512-Jt8ZaZ0cxE4dGQp5VL5uR9d5XLMiFCQ6aDy9Jfe1uCtRwqcGtWNNypKXzb1g4rzV/Q3LGmNuR3LwdiZuR3gR9g==` | 2026-09-24T20:52:22Z |
| 0.1.2 | `sha512-Y0nPq58J2yjEZI0yaW3KXSIwsEeDa0dLwGt5thtwGRwMGE+RM2Yoc4KC+AEep83Ms11N4VdFZBpBAaJ3giQXmg==` | 2026-09-24T20:52:16Z |
| 0.1.3 | `sha512-5E9zlWlS8kusSwh4cCs/Uq+Dh+CjVWMfGIZ+RGJKDH03tKHhxEMM74BEIl62SUQU1eQsNoknHd1aVOLMd7u1Hw==` | 2026-09-25T23:55:51Z |
| 0.1.4 | `sha512-0or+T8XCU8jLwhBA5t0x6E/51fpa/3iYDe8i2CCQaME317TBRrNU5406S/nD+LRbZrTFjxuPdT64rzbJeKQmCw==` | 2026-09-30T21:06:36Z |
| **0.2.0** | **`sha512-tFLUeMMiSUsaFyNAXBoQ98k/vN0n/o46BoRL/ygxr81YEkWv4k5VLVWpc9A4wBxrqOXz4dNA32lcYMwmDt32wQ==`** | **2026-10-06T20:21:13Z** |

其它 registry 事实（`npm view`）：`dist.shasum = 4720fd8c0a9065601f99517c016c1e17cb9f44f6`、`dist.fileCount = 22`、`dist.unpackedSize = 67808`、`maintainers = [jkudish <joey@jkudish.com>]`、`license = MIT`、`repository = github.com/jkudish/jev-agent-tools`、`gitHead = 8a237b9edaa6daa2125b60668faea60d356cfed7`、`engines.node = ">=22"`、`publishConfig.access = public`、`_hasShrinkwrap = false`。

**独立复算**：下载 `https://registry.npmjs.org/@jkudish/jev-agent-tools/-/jev-agent-tools-0.2.0.tgz`（18276 bytes）后本地重算：

```
sha512-base64 = sha512-tFLUeMMiSUsaFyNAXBoQ98k/vN0n/o46BoRL/ygxr81YEkWv4k5VLVWpc9A4wBxrqOXz4dNA32lcYMwmDt32wQ==  (== npm view / == jev-mcp 声明的范围)
sha1          = 4720fd8c0a9065601f99517c016c1e17cb9f44f6                                                  (== dist.shasum)
sha256        = 5cc2689ebf4de086f6688f5870f64549b4423cfb1da2b65fc21badd88543796d
```

### 1.3 `^0.2.0` 当前解析到什么

`^0.2.0` 的 semver 语义是 `>=0.2.0 <0.3.0`。registry 中**只有一个 0.2.x：0.2.0**，且 `dist-tags.latest` 也是 0.2.0。因此：

> **`^0.2.0` 当前确定性解析到 `0.2.0`。**

（注意：caret 解析只依赖版本列表，`dist-tags` 的移动不影响 caret 结果；即使作者把 `latest` 指向别处，`^0.2.0` 仍解析到 0.2.x 中最高的那个。）

### 1.4 该版本在 npm 上是否可变 — 必须区分两件事

- **已发布产物本身：不可变。** npm 禁止对同一 `name@version` 重复 publish；registry 记录的 `dist.shasum` / `dist.integrity` 对 0.2.0 固定。版本列表里 0.2.0 的 integrity 不会改变。
- **`^0.2.0` 的解析结果：可变，且无上界保护。** 只要作者发布任意 `0.2.1` / `0.2.2` / …，**全新安装**（或任何未命中现有 lockfile 的解析）就会装入新版本，而本仓 manifest 里没有任何字节会变化、任何校验会失败。

可变性评级：**高**。理由不只是"理论上有 caret"，而是有实证的发布节奏——该包 2026-09-24 首次发布，到 2026-10-06 已发 6 个版本（14 天内），`0.1.0 → 0.2.0` 之间 5 次递增；0.2.0 发布距本次审计仅 4 天。这是一个**活跃迭代、minor 内高频发布**的包，caret 漂移的实际概率不低。

---

## 2. Q2 — `@jkudish/jev-agent-tools@0.2.0` 运行时能力面

### 2.1 `package.json` 全文（tarball 内，逐字）

```json
{
  "name": "@jkudish/jev-agent-tools",
  "version": "0.2.0",
  "description": "Jev transport/provider layer: multi-provider transport layer that supports fail-closed validation. Used by jkudish/jev-browser and jkudish/jev-mcp.",
  "type": "module",
  "license": "MIT",
  "author": "Joey Kudish",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jkudish/jev-agent-tools.git"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "test": "node --test test/transports.test.mjs",
    "test:live": "node --test test/live.test.mjs"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^7.0.2"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### 2.2 安装钩子 — **无**

`scripts` 只有 `typecheck` / `build` / `test` / `test:live`。**没有** `preinstall`、`install`、`postinstall`、`prepare`、`prepack`、`prepublishOnly`。也没有 `bin` 字段。因此安装该包**不会触发任何脚本执行**。

（对照：`@jkudish/jev-mcp@0.14.1` 的 `scripts` 里有 `"prepare": "npm run build"`——但 `prepare` 对 registry tarball 依赖不执行，且其 `devDependencies` 不会为依赖安装，所以 `tsc` 也不存在。这一点列在 §7 残留观察里，不构成阻塞。）

### 2.3 依赖面 — **零运行时依赖**

`dependencies` 字段**不存在**。只有 `devDependencies`（`typescript`、`@types/node`），不会被安装。

```bash
$ grep -rhoE 'from "[^"]+"' dist/*.js dist/transports/*.js | sort -u
from "./provider.js"
from "./transports/cloudflare.js"
from "./transports/openrouter.js"
from "./transports/typesafe.js"
from "./transports/vercel.js"
```

**全部 import 都是相对路径，没有任何第三方 bare specifier。** 这是一个自包含的零依赖包——从供应链角度这是很强的正向信号（没有再下一层不受控的闭包）。

### 2.4 `child_process` — **无**

对 `child_process`、`exec(`、`spawn(`、`spawnSync`、`execSync`、`fork(` 的 grep 全部 **零匹配**（`dist/*.js` + `dist/transports/*.js`）。

### 2.5 文件读写 — **无**

对 `node:fs`、`readFile`、`writeFile`、`mkdir`、`rm(`、`unlink` 的 grep 全部 **零匹配**。该包不做任何文件系统访问。

### 2.6 入口文件清单（22 个文件，与 `dist.fileCount=22` 一致）

```
    2389  ./CHANGELOG.md
    1068  ./LICENSE
    9808  ./README.md
     262  ./dist/index.d.ts
     153  ./dist/index.js
     198  ./dist/index.js.map
    1758  ./dist/provider.d.ts
    8947  ./dist/provider.js
    8333  ./dist/provider.js.map
     101  ./dist/transports/cloudflare.d.ts
    3806  ./dist/transports/cloudflare.js
    3106  ./dist/transports/cloudflare.js.map
     236  ./dist/transports/openrouter.d.ts
    3904  ./dist/transports/openrouter.js
    3004  ./dist/transports/openrouter.js.map
      99  ./dist/transports/typesafe.d.ts
    5301  ./dist/transports/typesafe.js
    4473  ./dist/transports/typesafe.js.map
     556  ./dist/transports/vercel.d.ts
    4800  ./dist/transports/vercel.js
    4504  ./dist/transports/vercel.js.map
    1002  ./package.json
```

发布内容 = `dist/` + README/LICENSE/CHANGELOG + package.json，与 `files` 字段声明一致，**无隐藏额外文件**。

入口：`dist/index.js` 只有两行 re-export（无副作用）：

```js
export { ask, resolveTransport } from "./provider.js";
export { openrouterJevModel } from "./transports/openrouter.js";
```

模块作用域扫描（`provider.js`）只发现 `const drivers = [...]`、`const ROUNDING_STEP`、`const MAX_SUM_DRIFT` 及函数定义，**没有 import 期 I/O 或网络副作用**。

### 2.7 出站域名集合（穷举）

```bash
$ grep -rhoE 'https?://[a-zA-Z0-9._~:/?#@!$&*+,;=%-]+' dist | sort -u
https://ai-gateway.vercel.sh/v4/ai/evaluation-model
https://api.cloudflare.com/client/v4/accounts/$          # 模板: .../accounts/${account}/ai/run
https://api.typesafe.ai
https://github.com/jkudish/jev-browser
https://openrouter.ai/api/alpha/decisions
```

| 域名 | 用途 | 触发条件 |
|---|---|---|
| `https://api.typesafe.ai` | `POST /v1/systemone` | provider = typesafe（**本仓部署实际路径**） |
| `https://openrouter.ai/api/alpha/decisions` | OpenRouter Decisions | provider = openrouter |
| `https://api.cloudflare.com/client/v4/accounts/<acct>/ai/run` | Cloudflare Workers AI | provider = cloudflare |
| `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` | Vercel AI Gateway | provider = vercel |
| `https://github.com/jkudish/jev-browser` | **不是请求目标**，只是 `openrouter.js:2` 的 `REFERER` 常量值（HTTP-Referer header） |

TypeSafe base URL 可被 `TYPESAFE_BASE_URL` 覆盖（`typesafe.js:59`）——但见 §3，本仓部署下该变量**无法**从外部注入。**没有**任何遥测/上报/第三方分析域名。

### 2.8 凭据处理

读取的凭据变量（均只从**注入的 env record** 读取，transport 层不直接碰 `process.env`）：

| 变量 | 位置 |
|---|---|
| `TYPESAFE_API_KEY` | `typesafe.js:51,54,58` |
| `TYPESAFE_BASE_URL`（可选，非凭据） | `typesafe.js:59` |
| `OPENROUTER_API_KEY` | `openrouter.js:12,15,19`（要求 `sk-or-` 前缀） |
| `JEV_CLOUDFLARE_API_TOKEN` \| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | `cloudflare.js:3,6,10` |
| `AI_GATEWAY_API_KEY` | `vercel.js:30,33,37` |
| `JEV_VERCEL_ZERO_DATA_RETENTION`（策略开关） | `vercel.js` |
| `JEV_PROVIDER`（选择器） | `provider.js:7` |

外发方式：仅作为 `Authorization: Bearer <key>` header（`typesafe.js:71`、`openrouter.js:27`、`cloudflare.js:18`、`vercel.js:12`）。无其它位置暴露密钥。

**密钥泄漏防护（有正面证据）**：

- 错误文本只出现**变量名**，不出现值。未配置时的诊断（`provider.js:22`）是穷举变量名列表：
  `"No TYPESAFE_API_KEY, OPENROUTER_API_KEY (sk-or-), Cloudflare token (CLOUDFLARE_API_TOKEN or JEV_CLOUDFLARE_API_TOKEN) + CLOUDFLARE_ACCOUNT_ID, or AI_GATEWAY_API_KEY found. Set one, or JEV_PROVIDER to choose explicitly."`
- HTTP 错误**丢弃响应体**：`typesafe.js:91` → `throw Object.assign(new Error(\`TypeSafe API HTTP ${wire.status} (response omitted)\`), { status: wire.status })`。
- registry 层做**固定字符串白名单**，防止任意 driver 异常外泄（`provider.js:63-66`）：
  ```js
  const message = error instanceof Error && /^(Unknown JEV_PROVIDER|No TYPESAFE_API_KEY|JEV_PROVIDER=|JEV_VERCEL_ZERO_DATA_RETENTION must)/.test(error.message)
      ? error.message : "Jev provider configuration failed";
  ```
- `credentials` 只从传入的 `env` 读取，因此调用方可完全控制凭据面（本仓正是这么做的，见 §3）。

**未发现**任何把密钥写入日志、错误消息、文件或请求体（非 auth header）的代码路径。

---

## 3. Q3 — provider 顺序与"只设 `TYPESAFE_API_KEY` 是否确定走 TypeSafe"

**结论：确定（静态可判定），且是双重确定的。** 下面是完整代码依据。

### 3.1 逻辑已确实下沉到 `@jkudish/jev-agent-tools`

`jev-mcp@0.14.1` 全仓只有一处 import 该包（`dist/provider.js:5`），并且它的 `resolve()` 把**内置凭据规则与顺序**完全委托出去：

```js
// jev-mcp@0.14.1 dist/provider.js:5
import { ask, openrouterJevModel, resolveTransport } from "@jkudish/jev-agent-tools";

// jev-mcp@0.14.1 dist/provider.js:218-236
function resolve(env) {
    const explicit = (env.JEV_PROVIDER ?? "auto").toLowerCase();
    const hasCompatible = Boolean(env.JEV_API_KEY && env.JEV_API_BASE_URL);
    if (explicit === "compatible") { /* ...requires JEV_API_KEY + JEV_API_BASE_URL... */ return "compatible"; }
    // The published package owns the four built-in credential rules and order.
    if ((explicit === "auto" || explicit === "") && hasCompatible &&
        !env.TYPESAFE_API_KEY && !/^sk-or-/.test(env.OPENROUTER_API_KEY ?? "") &&
        !((env.JEV_CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN) && env.CLOUDFLARE_ACCOUNT_ID) &&
        !env.AI_GATEWAY_API_KEY)
        return "compatible";
    return resolveTransport({ ...env, JEV_PROVIDER: explicit || "auto" }).name;
}
```

### 3.2 agent-tools 的顺序逻辑（原文引用）

```js
// @jkudish/jev-agent-tools@0.2.0 dist/provider.js:1-25
import { typesafe } from "./transports/typesafe.js";
import { openrouter } from "./transports/openrouter.js";
import { cloudflare } from "./transports/cloudflare.js";
import { vercel } from "./transports/vercel.js";
const drivers = [typesafe, openrouter, cloudflare, vercel];

export function resolveTransport(env = process.env) {
    const explicit = (env.JEV_PROVIDER ?? "auto").toLowerCase();
    if (explicit !== "auto") {
        const driver = drivers.find((candidate) => candidate.name === explicit);
        if (!driver)
            throw new Error("Unknown JEV_PROVIDER; choose typesafe, openrouter, cloudflare, vercel, or auto.");
        try {
            driver.assertConfigured(env);
        }
        catch (error) {
            throw new Error(`JEV_PROVIDER=${driver.name} but ${error.message}`);
        }
        return driver.create(env);
    }
    const driver = drivers.find((candidate) => candidate.isConfigured(env));
    if (!driver) {
        throw new Error("No TYPESAFE_API_KEY, OPENROUTER_API_KEY (sk-or-), Cloudflare token ... found. Set one, or JEV_PROVIDER to choose explicitly.");
    }
    return driver.create(env);
}
```

两条关键性质：

1. **显式选择短路且 fail-closed**：`JEV_PROVIDER` 非 `auto` 时走第一分支，找不到名字就抛错、`assertConfigured` 失败就抛错，**绝不回落到其它 provider**。`typesafe.assertConfigured` 就是 `Boolean(env.TYPESAFE_API_KEY)`（`typesafe.js:51-55`）。
2. **auto 顺序即 `drivers` 数组顺序**：`[typesafe, openrouter, cloudflare, vercel]`，取第一个 `isConfigured`。TypeSafe 排第一。README（agent-tools）也确认："Auto-selection tries them in this order: **TypeSafe** (`TYPESAFE_API_KEY`…)…"。

### 3.3 本仓部署形状把它变成确定行为

本仓 `scripts/lib/third-party-resources.mjs` 的 launcher 渲染函数（`renderMcpLauncher`，347-375 行）逐字为：

```js
const key = process.env.TYPESAFE_API_KEY
if (!key) process.exit(78)
const child = spawn(process.execPath, [<entry>], {
  stdio: 'inherit',
  env: { TYPESAFE_API_KEY: key, JEV_PROVIDER: 'typesafe' },
})
```

而 `renderResourcePatch`（333 行）给 bridge 的 env 也只给一个键：

```yaml
env:
  TYPESAFE_API_KEY: !!js process.env.TYPESAFE_API_KEY
```

由此得到 4 条链式结论：

1. **`JEV_PROVIDER` 被硬编码为 `typesafe`** → §3.2 第一分支 → driver 名字匹配 → `assertConfigured` 因 key 存在而通过 → **返回 typesafe driver**。
2. **`spawn` 的 `env` 语义是替换而非合并**（Node `child_process` 文档：`env` 默认 `process.env`；一旦提供则子进程环境即该对象）。因此服务进程**只看到** `TYPESAFE_API_KEY` 与 `JEV_PROVIDER` 两个变量。`OPENROUTER_API_KEY` / `CLOUDFLARE_*` / `AI_GATEWAY_API_KEY` / `JEV_API_KEY` / `JEV_API_BASE_URL` 全部**不可能**存在。
   - 推论：`resolve()` 里 `hasCompatible` 恒为 false，`compatible` 分支不可达；`explicit === "auto"` 的 compatible 快捷分支也不可达。
3. **即使 `JEV_PROVIDER` 缺失**（回到 auto），`drivers` 顺序第一项就是 typesafe，且不存在任何竞争 provider 的凭据 → **仍解析到 typesafe**。所以"确定走 TypeSafe"不依赖单一机制，是两条独立路径的一致结果。
4. **`TYPESAFE_BASE_URL` 无法被父环境注入**（同样因为 env 是替换的）→ 出站目标被钉死在代码默认值 `https://api.typesafe.ai`（`typesafe.js:59`）。这顺便堵掉了一个"改 base URL 导流"的隐患。
5. 密钥缺失时 launcher 在 `spawn` 之前 `process.exit(78)` → 服务根本不会以无凭据状态启动。

### 3.4 与 0.6.0 的行为对比（确认本次升级不改变部署语义）

`jev-mcp@0.6.0` 也有自己的 `JEV_PROVIDER` 处理（`dist/provider.js:207-216`）：

```js
function resolve(env) {
    const explicit = (env.JEV_PROVIDER ?? "auto").toLowerCase();
    const hasTypesafe = Boolean(env.TYPESAFE_API_KEY);
    ...
    if (explicit === "typesafe") {
        if (!hasTypesafe)
            throw new Error("JEV_PROVIDER=typesafe but TYPESAFE_API_KEY is not set.");
        return "typesafe";
    }
```

即 **0.6.0 就已尊重 `JEV_PROVIDER=typesafe`**，0.14.1 只是把该契约搬进 agent-tools 并保持等价。launcher 的硬编码无需任何改动。

> **对既有 proposal 的一处更正**：`openspec/changes/upgrade-third-party-plugins/proposal.md` §4.5.5 的 flag #2 写道"0.14.1 **取消了 0.6.0 的启动期凭据 fail-fast**：缺 key 从'启动失败'变成'每次调用报错'"。**该表述不成立。**
> 证据：两个版本的 provider 解析都在 `askJev` 内**按调用**执行，而非模块作用域——
> - 0.6.0：`dist/provider.js:283-284` `export async function askJev(...) { const provider = resolve(process.env); ... }`；`dist/index.js` 中 12 处 `askJev(...)` 全部在工具 handler 内，模块作用域只有 `await server.connect(new StdioServerTransport())`（`index.js:1323`），不读凭据。（`provider.js:74` 的 `resolve()` 是 `new Promise` 执行器的参数，与 provider 无关。）
> - 0.14.1：`dist/provider.js:237-238` 同样是 `askJev` 内按调用解析。
>
> 因此 **0.6.0 没有启动期 fail-fast，0.14.1 也没有——行为未变**。而且在本仓部署下，真正的启动期 fail-fast 由 launcher 的 `process.exit(78)` 提供，两版皆然。建议 Lead 修正 proposal 中该条，避免把一个不存在的回归写进审查记录。

---

## 4. Q4 — 本仓 pin 纪律：工具能否发现该浮动依赖的漂移

**结论：不能。这是代码结构决定的，不是配置疏漏。** 逐点给出依据。

### 4.1 `check-plugin-updates.mjs` / `plugin-updates.mjs` — 看不到传递依赖

- **jev 本身确实在扫描范围内**。三方资源会以 `source: 'remote'`、`type: 'package'` 的合成条目进入 `customizations`（`sync.mjs:366` `resourcePackageItems(thirdPartyResources)`；`third-party-resources.mjs:191-223` 生成 `id: third-party-jev-runtime` 等），而 `detectRemotePluginUpdates` 正是遍历这个列表（`plugin-updates.mjs:174-175`）。所以 `0.6.0 → 0.14.1` 这个**直接**升级是可被发现的（proposal §开头"任何一轮 `plugin-update` 都不会提示它"指的是 `autoUpdate.enabled: false` 的自动更新通道，与本项不冲突）。
- **但传递依赖在取数层面就被排除了。** 取 registry 元数据的两个函数只请求这几个字段：
  ```js
  // plugin-updates.mjs:135
  npmSpawn(['view', name, 'dist-tags', 'versions', 'time', 'peerDependencies', 'deprecated', '--json'], ctx)

  // plugin-updates.mjs:99-107（HTTP 分支，accept: application/vnd.npm.install-v1+json）
  const latest = doc['dist-tags']?.latest
  const latestEntry = doc.versions?.[latest]
  return { latest, deprecated: latestEntry?.deprecated, peers: latestEntry?.peerDependencies ?? {}, publishedAt: doc.time?.[latest] }
  ```
  **`dependencies` 字段从未被请求。** 因此连 `@jkudish/jev-mcp` 自己的 `dependencies` map 都进不来，更不用说 `@jkudish/jev-agent-tools`。
- 判定逻辑只做一次扁平比较：`info.latest !== item.version`（`plugin-updates.mjs:186`），作用于被 pin 的包本身。

### 4.2 `third-party-resources.mjs` — 只校验已声明的三元组

- `packagePins()`（225-231 行）只收集 `resource.package` / `resource.provider` / `resource.bridge` —— 即 manifest 里**已声明**的三元组。
- `preflightResourceIntegrities()`（248-253 行）逐个用 `npm view <spec> dist.integrity` 与声明值比对；**清单里没有的包不会被检查**。
- `resourceHealth()`（269-295 行）对 `npm-mcp-server` 只断言四件事：runtime 目录 `package.json` 的 name/version 匹配、bridge 同理、`dist/index.js` 存在、launcher 存在。**完全不看传递依赖树，也不读任何 lockfile。**

→ 因此：**即使 `@jkudish/jev-agent-tools` 明天涨到 0.2.7，`npm test` / `check-plugin-updates` / `sync` 的 integrity preflight / `resourceHealth` 全部都会绿。** 漂移在仓库侧不可观测。

### 4.3 一个必须说清的细化：锁文件确实存在，但不在仓库里

只读探查发现部署 profile 里有 pnpm lockfile：

```
~/.dsh/profiles/web/pnpm-lock.yaml          (117602 bytes, lockfileVersion '9.0')
~/.dsh/profiles/web/package.json            dependencies: { '@jkudish/jev-mcp': '0.6.0', '@deepseek-ai/dsh-mcp-client': '0.2.0-rc.2' }  ← 精确，无 caret
```

lockfile 内确实把传递依赖钉到精确版本并带 integrity，例如：

```yaml
'@jkudish/jev-mcp@0.6.0':
  resolution: {integrity: sha512-AAQeZESEMatz5m5X/bojvcL3bpwTPxebFOXBSj66KKNOKznumhne2VsLQ9btxPWBS8obhbVvCInwooy7Phudtw==}
  engines: {node: '>=20'}
  hasBin: true
...
'@jkudish/jev-mcp@0.6.0':
  dependencies:
    '@modelcontextprotocol/sdk': 1.30.1
    '@typesafe-ai/sdk': 0.6.0
    ai: 7.0.116(zod@3.25.76)
    undici: 7.29.1
    zod: 3.25.76
```

**这把风险的性质精确化了**——它**不是**"已有机器上的静默升级"，而是：

> **跨机器 / 重新 provision 的发散**。机器 A 在 0.2.1 发布前安装，锁在 0.2.0；机器 B 之后 provision，解析到 0.2.1；两者跑着不同的代码，而仓库侧任何工具都不会报告差异。同时该 lockfile 位于 `~/.dsh`（部署态、非版本控制、不可复核），因此不构成 pin 纪律意义上的证据。
>
> 该结论的前提是"安装器尊重现有 lockfile 而不每次重解析"。DSH plugin manager 的实现不在本仓，**未读**，故这一条是推断而非已证事实（见 §7）。

### 4.4 影响被低估的部分：浮动 caret 不止 1 个，而是 5 个

`@jkudish/jev-mcp@0.14.1` 的 `dependencies` 全文：

```json
"dependencies": {
  "@jkudish/jev-agent-tools": "^0.2.0",
  "@modelcontextprotocol/node": "^2.1.1",
  "@modelcontextprotocol/server": "^2.3.1",
  "@typesafe-ai/sdk": "^0.6.0",
  "zod": "^4.6.5"
}
```

**全部 5 个都是浮动的 `^`，全部没有 integrity。** 既有审查只点名了 `jev-agent-tools`；按同一标准，`@modelcontextprotocol/server`（0.14.1 的 stdio 服务端实现本体）和 `@typesafe-ai/sdk` 的 caret 漂移同样不可观测。这应当在审查记录里如实写成"5 个浮动传递依赖面"，而不是 1 个。

（对照 0.6.0 的 `dependencies`：`ai ^7.0.105`、`zod ^3.25.0`、`undici ^7.29.1`、`@typesafe-ai/sdk ^0.6.0`、`@modelcontextprotocol/sdk ^1.17.0` —— 也是 5 个浮动。所以"浮动传递依赖"本身不是本次升级引入的新性质；**新增的是 jev-mcp 自己不再内联 provider 逻辑，而改由一个浮动包接管**，这提高了单点重要性。）

### 4.5 建议

1. **可以接受浮动 caret，不要为此阻塞本次升级。** 理由：`jev-agent-tools` 是**零运行时依赖、零 install 钩子、无 `child_process`、无文件 I/O** 的包；在本仓部署形状下，它的凭据/provider 路径被 launcher 的 `JEV_PROVIDER=typesafe` 硬钉（§3.3），出站目标也钉死。实际可控性很高。
2. **但必须把"已审查的确切状态"写进审查记录**：即 `^0.2.0` 在 2026-10-10 解析为 **`0.2.0`**、integrity `sha512-tFLUeMMiSUsaFyNAXBoQ98k/vN0n/o46BoRL/ygxr81YEkWv4k5VLVWpc9A4wBxrqOXz4dNA32lcYMwmDt32wQ==`。这样未来任何漂移都能被人工对照，而不是"当时是哪个版本已不可考"。
   - **重要约束**：该记录**不能**写进 `dsh.yaml` 的 jev 条目。`third-party-resources.mjs:32` 对 `npm-mcp-server` 白名单化了字段 `['id','type','enabled','spec','version','integrity','bridge','serverName','credentialEnv','toolCallTimeoutMs','reconnect']`，`noUnknown()`（43-47 行）**会拒绝 `note` 字段并抛错**。因此记录只能落在 OpenSpec change 的审查文档里（`openspec/changes/upgrade-third-party-plugins/`，符合 AGENTS.md"时间点性的调研与验收记录归入所属 OpenSpec change"）。
3. **要求"下次触碰该 pin 时重新审计 5 个浮动依赖的解析结果"** 作为升级复核点（与既有 `jev-workflow-router` 的"升级复核"约定同构）。
4. **若要让漂移变成可强制定量发现**，需要新增能力（例如安装后读取 profile 依赖树/lockfile 与一份记录过的 allowlist 比对，并纳入 `resourceHealth`）。这是一个独立 change 的范围，**不应**塞进本次 pin 变更。本次不要顺手扩大改动面。

---

## 5. Q5 — 升级到 0.14.1 的确切三元组与 entry 字段核查

### 5.1 三元组（全部已独立复算）

```yaml
spec: '@jkudish/jev-mcp@0.14.1'
version: 0.14.1
integrity: sha512-HGG0NyKGdGBTyIUsrxXdf3Da0rVBk0YM2p8zDRcZXnbAxaa/EOC9vFWgD5/snVz0K0NiSmz1eMh/aahbxPoQ7w==
```

三条独立证据一致：

| 来源 | 值 |
|---|---|
| `npm view @jkudish/jev-mcp@0.14.1 dist.integrity` | `sha512-HGG0NyKGdGBTyIUsrxXdf3Da0rVBk0YM2p8zDRcZXnbAxaa/EOC9vFWgD5/snVz0K0NiSmz1eMh/aahbxPoQ7w==` |
| 本地重算下载 tarball 的 sha512-base64 | `sha512-HGG0NyKGdGBTyIUsrxXdf3Da0rVBk0YM2p8zDRcZXnbAxaa/EOC9vFWgD5/snVz0K0NiSmz1eMh/aahbxPoQ7w==` ✅ |
| 交叉校验 | `dist.shasum` = `e9671ebc21667e9def864c0903d4d43abb7aa072` == 本地 sha1 ✅ |

补充指纹：tarball 95508 bytes，`sha256 = 528befa11ee338bcee447dafbf01aaa0708f5879cf38ff6aeb5736a933ec66e5`。
`dist-tags.latest` = `0.14.1`（即本次升级确实对齐 registry latest）。

顺带复核当前 pin 未被篡改：`@jkudish/jev-mcp@0.6.0` 本地重算 sha512 == manifest 现值 `sha512-AAQeZESEMatz5m5X/bojvcL3bpwTPxebFOXBSj66KKNOKznumhne2VsLQ9btxPWBS8obhbVvCInwooy7Phudtw==` ✅。

格式合规性：`EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/` 匹配 `0.14.1`；`SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/` 匹配上面的 integrity。`version` 必须严格等于 spec 中的版本（第 61 行），此处 `0.14.1 === 0.14.1` ✅。

### 5.2 `bridge` — **不需要改**

manifest 现值：`@deepseek-ai/dsh-mcp-client@0.2.0-rc.2` + `sha512-UqP2sY1r6qAhBPFeuclqrXiMBBxPaCNrXlXRqKxAON7uI1wmZZ0B3/1GmBviQ3/WjjTQlOOkj0su2v4e5DMkug==`。

证据 1 —— **该 pin 仍然有效且与 registry 一致**：

```
$ npm view @deepseek-ai/dsh-mcp-client@0.2.0-rc.2 version dist.integrity --json
{ "version": "0.2.0-rc.2",
  "dist.integrity": "sha512-UqP2sY1r6qAhBPFeuclqrXiMBBxPaCNrXlXRqKxAON7uI1wmZZ0B3/1GmBviQ3/WjjTQlOOkj0su2v4e5DMkug==" }
```

证据 2 —— **bridge 走 stdio，实现来自 v2 代 SDK**（`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js`）：

```js
:6   import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
:40  case "stdio": return new StdioClientTransport({ ... })
```

该 bridge 的 `dependencies` 精确含 `@modelcontextprotocol/client: 2.0.0`。

证据 3 —— **协议版本区间实测同一**（这是比"有交集"更强的结论）。两侧 core 常量逐字相同：

```js
// bridge 侧：@modelcontextprotocol/core@2.0.0（由 @modelcontextprotocol/client@2.0.0 引入）
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_PROTOCOL_VERSIONS = [ LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07" ];

// jev-mcp 0.14.1 侧：@modelcontextprotocol/server@2.3.1 → @modelcontextprotocol/core@2.3.1
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_PROTOCOL_VERSIONS = [ LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07" ];
```

`initialize` 协商时双方 `LATEST_PROTOCOL_VERSION` 一致为 **`2025-11-25`**，可用集合完全重合 → 握手不会因协议版本被拒。（附带更正：proposal §4.5.5 称"其 dist 明确协商 `2026-07-28`；0.14.1 服务端对 2025 代客户端仍回落兼容"，方向正确但论证偏弱——`2026-07-28` 只是客户端额外支持的更新修订；决定协商结果的是 core 常量，两侧完全一致。`@modelcontextprotocol/server@2.3.1` 的 http 模块注释亦提到 "Serves MCP 2026-07-28 per request and 2025-era clients"。）

证据 4 —— **0.14.1 的入口仍默认 stdio**。manifest 的 bridge config 用 `transport: stdio` + `args: [launcher]`，launcher 用 `spawn(process.execPath, [<pkg>/dist/index.js])` 且不传任何 argv。0.14.1 `dist/index.js`：

```js
if (process.argv.includes("--http") || process.env.JEV_MCP_TRANSPORT === "http") {
    const { serveHttp } = await import("./http.js");
    ...
} else {
    serveStdio(createServer);
}
```

argv 无 `--http`，且 launcher 的 env 是替换的、不含 `JEV_MCP_TRANSPORT` → **走 `serveStdio`**。并且 `dist/index.js` 在 0.14.1 中仍然存在（`resourceHealth` 与 `syncManagedLaunchers` 依赖的正是 `<pkg>/dist/index.js`，`third-party-resources.mjs:288,573`）——**该路径未被 0.14.1 的 `exports` 变化影响**（0.14.1 的 `exports["."] → ./dist/server.js`，但 launcher 用的是文件路径而非包导入）。

### 5.3 `serverName` — **不需要改**

- DSH 侧的 `serverName: jev` 是本仓标签，由 `renderResourcePatch`（333 行 `serverName: ${q(resource.serverName)}`）写进 bridge config，并决定工具前缀 `mcp__jev__`（`scripts/jev-readiness.mjs:61` 校验 `mcp__jev__jev_classify` / `mcp__jev__jev_decide`）。
- 服务端**自报名未变**：0.6.0 `dist/index.js:26` `new McpServer({ name: "jev-mcp", version: packageVersion })`；0.14.1 `dist/server.js:38` `new McpServer({ name: "jev-mcp", version: packageVersion }, { capabilities: { tools: { listChanged: false } } })`。两侧自报名均为 `"jev-mcp"`，且它并不参与 DSH 的 `serverName` 解析。
- `validateMcp`（94-96 行）只要求 `serverName` 匹配 `[A-Za-z0-9_-]{1,32}` 且全局唯一 —— `jev` 仍然合规、仍然唯一。

### 5.4 `credentialEnv` — **不能改**

`third-party-resources.mjs:97` 是硬编码的 fail-closed 断言：

```js
if (resource.credentialEnv !== 'TYPESAFE_API_KEY') throw new Error(`${label}.credentialEnv: must be TYPESAFE_API_KEY`)
```

任何其它值都会使 manifest 校验直接失败。同时它也是**语义正确**的变量名：agent-tools typesafe transport 的 `isConfigured: (env) => Boolean(env.TYPESAFE_API_KEY)`（`typesafe.js:51`），0.14.1 未改变该变量名。**两边一致，不需要改。**

### 5.5 `toolCallTimeoutMs` — **不需要改**（且同款不一致在 0.6.0 已存在）

- manifest 现值 `30000`。
- jev 内部有一个**整请求**预算：`REQUEST_TIMEOUT_MS = positiveIntFromEnv("JEV_MCP_REQUEST_TIMEOUT_MS", 60_000)`（0.14.1 `dist/provider.js:25`），配合 `MAX_ATTEMPTS = 3`（第 27 行）。
- **0.6.0 的值完全相同**：`dist/provider.js:27` `const REQUEST_TIMEOUT_MS = positiveIntFromEnv("JEV_MCP_REQUEST_TIMEOUT_MS", 60_000)`、第 29 行 `MAX_ATTEMPTS = 3`。
  → 所以"外层 30s 比内层 60s 紧"这个预算不一致是**既有状态，不是本次升级的回归**（此处与 proposal §4.5.5 flag #3 一致 ✅）。
- 由于 launcher 的 env 是替换的，`JEV_MCP_REQUEST_TIMEOUT_MS` **也无法**从外部下调；内层 60s 固定生效，外层 30s 为实际约束。
- 结论：本次**不改** `toolCallTimeoutMs`。可选加固（把 `JEV_MCP_REQUEST_TIMEOUT_MS` 加进 launcher env 以压低内层预算）需要改 `renderMcpLauncher` 源码、会改变超时语义、并超出"改 pin"范围 —— **建议单独立项，不要塞进本次**。

### 5.6 工具集变化 — 纯加法（附带证据）

```
$ diff <(0.6.0 的 jev_* 名字) <(0.14.1 的 jev_* 名字)
0a1
> "jev_audit"
6a8
> "jev_noul"
```

0.6.0 = 10 个（`classify, compare, decide, extract, find, gate, rerank, review, screen, verify`）→ 0.14.1 = 12 个，**只有新增、无改名无删除**。既有 preset / 文档 / `jev-workflow-router` 的候选契约引用不受影响。

### 5.7 其它需要 Lead 知道的核查

- **`engines.node`**：0.6.0 `>=20` → 0.14.1 `>=22`（`jev-agent-tools` 亦 `>=22`）。本机 `v24.16.0` ✅ 满足。
- **`zod` 3 → 4**，`@modelcontextprotocol/sdk ^1.x` → `@modelcontextprotocol/{server,node}` v2 代，移除 `ai` / `undici`。属依赖面重构，已被 §5.2 的协议证据覆盖。
- **`scripts/jev-readiness.mjs` 不需要改**：它的 `expectedVersions()`（72-83 行）**从 `dsh.yaml` 的 `thirdPartyResources` 动态读取** `jev.version` / `jev.bridge.version`（注释明确写了"Expected exact versions come from the manifest's thirdPartyResources, so a provider bump … cannot leave this probe asserting a stale literal"）。改 pin 后自动跟随。
- **`tests/third-party-resources.test.mjs` 不需要改**：其中的 `0.6.0`（42-43、104、145、226 行）是**自建 fixture** —— 该文件不读 `dsh.yaml`（grep `dsh.yaml` / `manifestPath` / `readFileSync` 无匹配），且使用自己的 integrity 常量 `I`、自己的 bridge `0.1.5-rc.2`、自己的 `toolCallTimeoutMs: 15000`。dsh.yaml 改 pin 不影响它。
- 归档 change（`openspec/changes/archive/2026-09-25-bootstrap-jev-workflow-routing/`）里的 `0.6.0` 是**历史证据**，不应回改。

---

## 6. 建议的审查记录要写进去的事实（供 Lead 引用）

| 事实 | 值 |
|---|---|
| jev-mcp 0.6.0 → 0.14.1 | `spec` / `version` / `integrity` 三处同改 |
| 新 integrity | `sha512-HGG0NyKGdGBTyIUsrxXdf3Da0rVBk0YM2p8zDRcZXnbAxaa/EOC9vFWgD5/snVz0K0NiSmz1eMh/aahbxPoQ7w==`（npm view + 本地重算一致） |
| 浮动传递依赖面 | **5 个 caret 全部无 integrity**：`@jkudish/jev-agent-tools ^0.2.0`、`@modelcontextprotocol/node ^2.1.1`、`@modelcontextprotocol/server ^2.3.1`、`@typesafe-ai/sdk ^0.6.0`、`zod ^4.6.5` |
| `^0.2.0` 审查时解析结果 | **0.2.0**（该包唯一 0.2.x；integrity `sha512-tFLUeMMiSUsaFyNAXBoQ98k/vN0n/o46BoRL/ygxr81YEkWv4k5VLVWpc9A4wBxrqOXz4dNA32lcYMwmDt32wQ==`） |
| agent-tools 能力面 | 零运行时依赖 / 无 install 钩子 / 无 `child_process` / 无文件 I/O / 出站 4 域名 |
| 漂移可观测性 | 仓库工具**不可**发现（`dependencies` 字段从不被请求） |
| 部署期凭据路径 | launcher 硬编码 `JEV_PROVIDER=typesafe`，env 替换式传递 → 确定 typesafe，base URL 钉死 `https://api.typesafe.ai` |
| bridge | 不改；两侧 core 协议常量 `LATEST_PROTOCOL_VERSION = "2025-11-25"` 完全一致 |
| 需同步修正的既有文档 | proposal §4.5.5 flag #2（"取消启动期 fail-fast"）不成立，见 §3.4 |

---

## 7. 明确"未确定"部分（Not Determined）

以下事项在本任务约束下**没有**被确定，不应被当作已验证事实：

1. **没有做真实 MCP 握手，也没有做一次真实判断调用。**
   任务禁止执行被审包代码，所以 §3 的 provider 结论与 §5.2 的协议结论都是**强静态推断**。两者的收口动作都是：安装后真实调用一次 `mcp__jev__jev_classify` 并确认返回带概率的答案、（建议）同时确认 `serverInfo` 与协商到的协议版本。
2. **`^0.2.0` 的未来解析结果不可知。**
   0.2.1+ 是否发布、是否改变 provider 选择语义或新增能力，**无法静态确定**。本报告只断言"当前解析到 0.2.0"。
3. **DSH plugin manager 的安装语义未读。**
   §4.3 关于"已有机器保持旧解析、新机器漂移"的推断基于 `~/.dsh/profiles/web/pnpm-lock.yaml` 的存在与内容，**未**阅读 DSH core 的安装实现来确认它是否在每次 sync 时尊重 lockfile、还是重新解析。该代码不在本仓。（可确证的部分只有：**仓库侧工具无论如何都看不到这个漂移**。）
4. **`@modelcontextprotocol/node ^2.1.1` 未被审计。**
   它是 0.14.1 的另一个浮动依赖，本次未纳入能力面/出站域名审计范围。`@modelcontextprotocol/server ^2.3.1` 只做了协议版本相关的定向检查（§5.2），未做完整能力面审计。
5. **4 个非 agent-tools 浮动依赖的下层闭包未展开。**
   `@modelcontextprotocol/*` / `@typesafe-ai/sdk` / `zod` 各自的传递闭包未被审计。
6. **registry 签名未做密码学验证。**
   `npm view` 显示 `@jkudish/jev-agent-tools@0.2.0` 带 `dist.signatures`（keyid `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`）。本次只用 sha512 integrity 与 shasum 核对，**未**验证该签名链（离线无 keys）。
7. **`jev-mcp@0.14.1` 自身的 `prepare` 脚本未在真实安装路径下验证。**
   它声明了 `"prepare": "npm run build"`。按 npm 语义，registry tarball 依赖不执行 `prepare`（且 devDeps 不装，`tsc` 也不存在）。本次**未实跑安装**来确认这一语义，属静态推断。

---

## 8. 复现命令（全部只读）

```bash
# 准备（唯一允许的写入路径）
mkdir -p .tmp-audit/jev && cd .tmp-audit/jev

# Q1 元数据
npm view @jkudish/jev-agent-tools --json
npm view @jkudish/jev-agent-tools dist-tags versions --json
for v in 0.1.0 0.1.1 0.1.2 0.1.3 0.1.4 0.2.0; do npm view "@jkudish/jev-agent-tools@$v" dist.integrity --json; done

# Q5 三元组
npm view @jkudish/jev-mcp@0.14.1 dist.integrity dist.shasum dist.tarball --json

# tarball 下载与独立复算
curl -sS -o jev-mcp-0.14.1.tgz      https://registry.npmjs.org/@jkudish/jev-mcp/-/jev-mcp-0.14.1.tgz
curl -sS -o jev-agent-tools-0.2.0.tgz https://registry.npmjs.org/@jkudish/jev-agent-tools/-/jev-agent-tools-0.2.0.tgz
node -e 'const c=require("crypto"),f=require("fs");for(const x of ["jev-mcp-0.14.1.tgz","jev-agent-tools-0.2.0.tgz"])console.log(x,"sha512-"+c.createHash("sha512").update(f.readFileSync(x)).digest("base64"))'

# Q2 能力面
mkdir -p x-agent-tools && tar -xzf jev-agent-tools-0.2.0.tgz -C x-agent-tools
cd x-agent-tools/package
grep -rn "child_process\|node:fs\|readFile\|writeFile\|spawn(" dist          # 期望：零匹配
grep -rhoE 'from "[^"]+"' dist/*.js dist/transports/*.js | sort -u          # 期望：仅相对路径
grep -rhoE 'https?://[a-zA-Z0-9._~:/?#@!$&*+,;=%-]+' dist | sort -u
cat package.json

# Q4 工具可观测性
grep -n "dependencies" scripts/lib/plugin-updates.mjs                      # 期望：无匹配
```
