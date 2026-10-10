# archify-dsh 1.0.0 审计：出站更新检查 与 Chrome 启动行为

- 审计对象：`@tt-a1i/archify-dsh@1.0.0`（对比 `0.1.0`），制品来自 npm registry tarball。
- tarball 校验：`1.0.0` sha256 `d009c4709000915e254d709b8f023b20d2cced142cd086e56f03d96baf370b50`；`0.1.0` sha256 `3192afe54949da6494acea3bd2bf5113a58ea78651113b1289bcc7212130df38`。
- 解包位置：`.tmp-audit/archify/v1/package/`、`.tmp-audit/archify/v0/package/`。下文行号中的 `v1/…`、`v0/…` 均指这两个根。
- 本仓库当前 pin：`dsh.yaml:86` → `spec: '@tt-a1i/archify-dsh@0.1.0'`。
- 只读审计：未执行任何包内代码、未安装、未改动任何受版本控制文件。
- 1.0.0 内嵌 Archify skill 版本：`v1/package/release.json` → `skillVersion: "3.0.1"`。

---

## 结论速览

| 问题 | 结论 |
|---|---|
| 出站请求干什么 | 一次 HTTPS `GET` 取静态版本清单，只做"有没有新版"提示。**没有任何本机标识/路径/内容上行**。有超时（≤4s）、有离线缓存（TTL 24h）、失败不致命。有官方开关 `ARCHIFY_UPDATE_CHECK_DISABLED=1`。 |
| SSH 下 Chrome | **永远不会弹窗**——它只会以 `--headless=new` 启动，无 GUI。本机（SSH 会话内）实测 headless Chrome 启动成功。找不到 Chrome → 该阶段 `skipped` → **`finalize` 退出码 2、`ok:false`**（但 HTML 已经生成）。 |
| 能不能关掉浏览器那一步 | **没有这个开关。** 不存在 `--skip-browser-check` / `--no-browser` 之类。`finalize` 只有 `ARCHIFY_CHROME`（改指向）可用；把它设为空串可强制走 skip 路径（代码可证），但那也只等于"没装 Chrome"，`finalize` 依然非 0。 |
| 能否经 cockpit 用上 | **不可行。** browser-check 不暴露也不消费任何 CDP 端口/端点，它是 `--remote-debugging-pipe` 走 stdio 的自生子进程。cockpit 的端口转发没有可对接的 socket。 |

---

## 1. 出站请求（"出栈"）是干什么的

### 1.1 调用链与代码

`v1/package/skills/archify/bin/finalize.mjs:699`：

```js
  // The gates below usually take seconds, so a slower network can finish the
  // update check in parallel instead of timing out on every delivery.
  const updateCheck = startUpdateCheck({ env, deadlineMs: FINALIZE_UPDATE_DEADLINE_MS });
```

- 截止时间常量：`finalize.mjs:22` → `const FINALIZE_UPDATE_DEADLINE_MS = 4_000;`
- `startUpdateCheck` 从 `./delivery-update.mjs` 导入（`finalize.mjs:19`），它 spawn 一个子进程：

`v1/.../bin/delivery-update.mjs:56`：

```js
      child = spawn(process.execPath, [checkerPath, String(deadlineNs)], {
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
```

`checkerPath` 指向 `scripts/delivery-update-child.mjs`（`delivery-update.mjs:5`），后者 `delivery-update-child.mjs:14-22` 调用 `checkForUpdate({ timeoutMs: Math.max(1, Math.floor(remainingMs - 150)) })`，即真正的网络请求方是 `scripts/check-update.mjs`。

### 1.2 请求本身：目标、方法、payload

固定 URL，`v1/.../scripts/update-contract.mjs:3`：

```js
export const DEFAULT_MANIFEST_URL = 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json';
```

URL **不可被指向别处**——`v1/.../scripts/check-update.mjs:1383`：

```js
  if (manifestUrl !== DEFAULT_MANIFEST_URL) throw new UpdateContractError('unexpected manifest URL');
```

请求形态，`check-update.mjs:1393-1399`：

```js
    const headers = { accept: 'application/json' };
    const response = await fetchImpl(manifestUrl, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
```

**上行内容判定（Q：payload 是否含本机任何标识/路径/内容）：不含。**
- 方法为 `GET`，没有 request body。
- 头部只有 `accept: application/json`；**没有 User-Agent、没有 cookie、没有 machine id、没有路径、没有图内容**。
- `redirect: 'error'`：不跟随跳转，降低被重定向采集的风险。

**下行内容**：一个静态 JSON 清单，键被严格白名单校验（`update-contract.mjs:140-182` `validateStableUpdateManifest`），字段为 `schemaVersion / skillId / channel / version / publishedAt / source{repository,ref,treeSha} / artifact{sha256} / summary / releaseNotes / severity`。校验是**精确键集**（`update-contract.mjs:22-25` `hasExactKeys`），多一个键即判非法；`releaseNotes` 必须精确等于 GitHub release tag URL（`update-contract.mjs:129-138`）；summary ≤160 字符且禁止控制/BiDi 字符（`update-contract.mjs:158-161`）。响应体积上限 32 KiB（`check-update.mjs:34` `MAX_RESPONSE_BYTES = 32 * 1_024`）。

### 1.3 用途：只做"有没有新版"提示

`check-update.mjs:1297-1311` 的 `notification()` 产出 `status: 'update_available'` 与 `noticeRequired: true`，`delivery-update.mjs:27-31` 生成固定本地文案：

```js
  const noticeText = noticeRequired
    ? `Archify ${result.severity === 'security' ? 'security update' : 'update'}: ${result.installedVersion} → ${result.latestVersion}. ${cached
      ? `A previous check at ${result.checkedAt} found a newer release.`
      : 'A newer release is available.'} Release notes: ${result.releaseNotes}. The installed Skill has not changed; ask to snooze or ignore this reminder.`
    : null;
```

明确不安装、不下载、不执行更新——`v1/.../references/update-awareness.md:12`：

> The notice is information, not permission. Keep the installed version unchanged. This workflow never downloads, installs, or executes an update, and silence is never consent.

`SKILL.md:46` 要求 agent 把这一条更新提示转述给用户，即它是**通知面**而非执行面。

### 1.4 频率 / 缓存 / snooze / ignore

- 成功结果 TTL：`check-update.mjs:29` → `const CHECK_TTL_MS = 24 * 60 * 60 * 1_000;`（24 小时）。`freshStateResult`（`check-update.mjs:1441-1448`）在缓存仍新鲜时直接返回缓存结果，**不发请求**。
- 失败退避：`check-update.mjs:31-32` → 首次失败延迟 6h（`FIRST_FAILURE_DELAY_MS`），后续失败 24h（`LATER_FAILURE_DELAY_MS`）。失败也会被记录，不会每次重试。
- 离线缓存目录（`check-update.mjs:1428-1438`）：macOS `~/Library/Caches/archify-skill`；Linux `$XDG_CACHE_HOME/archify-skill` 或 `~/.cache/archify-skill`；Windows `%LOCALAPPDATA%\archify-skill`。
- snooze/ignore 偏好存在并在结果中生效：`check-update.mjs:1326-1329`

```js
  if (preference?.mode === 'ignore') return { ...result, noticeRequired: false, reason: 'ignored' };
  if (preference?.mode === 'snooze' && Date.parse(preference.until) > nowMs) {
    return { ...result, noticeRequired: false, reason: 'snoozed', suppressedUntil: preference.until };
  }
```

  CLI 入口：`check-update.mjs:1678-1686`（`--ack` / `--snooze <eventKey>` / `--ignore <eventKey>`）；`--ack` 是 no-op。`update-awareness.md:10` 规定**只能由用户明确要求时**才 snooze/ignore（snooze 7 天，ignore 只压这一版）。
- 上游还有两个本地文件级覆盖变量（`delivery-update-child.mjs:15-18`）：`ARCHIFY_UPDATE_RELEASE_PATH`、`ARCHIFY_UPDATE_CACHE_DIRECTORY`。

### 1.5 是否阻塞交付 / 超时 / 失败是否致命

- **不阻塞交付**：请求在 `finalize` 的 gates **之前**启动（`finalize.mjs:699`），与 `deliver/check/browser-check` 并行；注释即写明此意图。
- **有硬上限**：父进程 4s（`finalize.mjs:22`），子进程在 deadline 到点被 `SIGKILL`（`delivery-update.mjs:68-71`），子进程自身再设一层 watchdog（`delivery-update-child.mjs:11`）。最坏情况 `finalize.mjs:888`（`receipt.update = await updateCheck;`）与 `finalize.mjs:893`（`finally` 中 `await updateCheck;`）最多多等约 4s。
- **失败不致命**：任何异常路径都归一到 `unavailable(reason)`（`delivery-update.mjs:9-13`），例如 `timeout` / `check-failed` / `disabled` / `runtime-unavailable` / `invalid-result`。这只影响 receipt 里的 `update` 字段，**不影响 exit code、不影响 artifact**。
- 去重：`finalize` 给 `deliver` 子阶段显式注入禁用变量，避免同一次交付查两遍——`finalize.mjs:750`：

```js
        result = await runCommand({ stage, cliPath, args, cwd,
          env: stage === 'deliver' ? { ...env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } : env });
```

### 1.6 官方开关（存在，已验证）

`delivery-update.mjs:51`：

```js
  if (env.ARCHIFY_UPDATE_CHECK_DISABLED === '1') return Promise.resolve(unavailable('disabled'));
```

`check-update.mjs:54` 里还有第二处同等判定（覆盖直接调用脚本的场景）：

```js
  return process.env.ARCHIFY_UPDATE_CHECK_DISABLED === '1';
```

**`ARCHIFY_UPDATE_CHECK_DISABLED=1` 是官方出站检查关闭开关**，效果为 `update.status = 'unavailable'`、`reason = 'disabled'`，完全静默、零网络。

---

## 2. Chrome 启动的完整条件与失败模式

### 2.1 `browser-check` 是 `finalize` 的强制阶段

`v1/.../bin/finalize.mjs:21`：

```js
export const FINALIZE_STAGES = Object.freeze(['validate', 'deliver', 'check', 'browser-check']);
```

实际执行循环是**无条件**的——`finalize.mjs:726`：

```js
    for (const stage of ['deliver', 'check', 'browser-check']) {
```

**没有条件分支、没有跳过参数、没有"Chrome 缺失则不跑该阶段"的判断。**该阶段在进程内执行（`finalize.mjs:737`：`const inProcess = stage === 'browser-check' && runBrowserCheck;`），CLI 装配见 `v1/.../bin/archify.mjs:5700-5702`：

```js
      runBrowserCheck: options => executeBrowserEvidence({
        ...options, command: 'browser-check', capture: false, requireProvenance: true,
      }),
```

### 2.2 Chrome 如何被发现

唯一发现函数 `v1/.../bin/visual-check.mjs:1309-1347`：

```js
export function findChrome({
  env = process.env,
  platform = process.platform,
  resolveExecutable = executable,
} = {}) {
  if (Object.prototype.hasOwnProperty.call(env, 'ARCHIFY_CHROME')) {
    return resolveExecutable(env.ARCHIFY_CHROME, platform);
  }

  const fixed = [];
  const commands = [];
  if (platform === 'darwin') {
    fixed.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else if (platform === 'win32') {
    ...
    commands.push('chrome', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  } else {
    commands.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  }
```

判定可用性用 `X_OK`（可执行位）——`visual-check.mjs:1283-1291`：

```js
function executable(file, platform = process.platform) {
  if (!file) return null;
  try {
    fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return path.resolve(file);
  } catch {
    return null;
  }
}
```

- **环境变量覆盖**：`ARCHIFY_CHROME`（唯一一个；`hasOwnProperty` 判定，因此"设为空串"也能命中该分支）。
- **不认** `CHROME_PATH`、`PUPPETEER_EXECUTABLE_PATH`、`GOOGLE_CHROME_BIN` 等常见变量（全包 grep 无命中）。
- macOS 只认上面两个硬编码路径（`/Applications` 下）；Linux/Windows 靠 `PATH` 查命令名。
- 返回 `null` 表示找不到。

### 2.3 是否支持 headless —— 支持，且 headless 是**唯一**模式

`visual-check.mjs:1481-1508`：

```js
export function chromeVisualBrowserArgs(profileRoot, {...} = {}) {
  const args = [
    '--headless=new',
    '--remote-debugging-pipe',
    '--disable-gpu',
    ...
    `--user-data-dir=${profileRoot}`,
    'about:blank',
  ];
  const rootUser = typeof getuid === 'function' && getuid() === 0;
  const sandboxOptOut = env?.[CHROME_NO_SANDBOX_ENV] === '1';
  if (rootUser || sandboxOptOut) args.unshift('--no-sandbox');
  return args;
}
```

- **GUI 非必需**：永远带 `--headless=new`，没有任何有头模式开关。
- 每次运行使用 `mkdtempSync(os.tmpdir()+'archify-visual-check-profile-')` 建的**一次性私有 profile**（`visual-check.mjs:1531`），不碰用户日常 Chrome profile。
- `--no-sandbox` 自动条件：以 root 运行或 `ARCHIFY_CHROME_NO_SANDBOX=1`（常量见 `visual-check.mjs:46`：`export const CHROME_NO_SANDBOX_ENV = 'ARCHIFY_CHROME_NO_SANDBOX';`）——这对 root 容器/CI 场景有用。

### 2.4 找不到 Chrome 时：skip，不是 fail

`v1/.../bin/visual-check.mjs:2451-2482`：

```js
  const resolvedChrome = chromePath || resolveChrome();
  receipt.chrome = resolvedChrome
    ? { status: 'available', executable: resolvedChrome }
    : { status: 'unavailable', executable: null };

  if (!resolvedChrome) {
    receipt.status = 'skipped';
    receipt.containment.status = 'skipped';
    receipt.readability.status = 'skipped';
    receipt.viewerChrome.status = 'skipped';
    receipt.themeStates.status = 'skipped';
    if (capture) receipt.captures.status = 'skipped';
    receipt.error = 'Chrome or Chromium is unavailable. Set ARCHIFY_CHROME to its executable path.';
    receipt.diagnostics = [failureDiagnostic({
      code: 'viewer/chrome-unavailable',
      severity: 'warning',
      ...
    })];
    ...
    return { exitCode: EXIT.skipped, receipt };
  }
```

退出码定义（`visual-check.mjs:45`）：`const EXIT = Object.freeze({ pass: 0, fail: 1, skipped: 2 });`

**该阶段自身是 skip（exit 2）而非 fail。**但回到 `finalize` 后，skip 会让整条 `finalize` 非 0：

`finalize.mjs:369`：

```js
  if (exitCode === 2 || receipt?.status === 'skipped') return 'skipped';
```

`finalize.mjs:839-851`：

```js
      if (status !== 'pass') {
        exitCode = status === 'skipped' ? 2 : (code || 1);
        receipt.status = status;
        ...
        break;
      }
      persistReceipts();
    }

    receipt.ok = exitCode === 0;
    receipt.status = receipt.ok ? 'pass' : receipt.status === 'running' ? 'fail' : receipt.status;
```

CLI 把它落成进程退出码（`v1/.../bin/archify.mjs`，`commandFinalize` 内：`process.exitCode = result.exitCode;`）。

### 2.5 `finalize` 是否仍产出 HTML —— 产出

循环顺序是 `['deliver', 'check', 'browser-check']`（`finalize.mjs:726`），`deliver` 阶段负责写入 `<output.html>`；`browser-check` 是**最后**一步。Chrome 缺失时：

- HTML **已经在磁盘上**，由 `deliver` 原子提交，且过完 `validate`(embedded) 与严格 `check`；`browser-check` 不改写 artifact（`references/delivery-contract.md:419`："Both browser commands inspect the exact delivered HTML without modifying or rerendering it."）。
- `receipt` 落盘：`ok:false`、`status:'skipped'`、`failedStage:'browser-check'`、`gates = {validate:'pass', deliver:'pass', check:'pass', 'browser-check':'skipped'}`（gates 组装见 `finalize.mjs:493-495`）。
- 诊断条目为 `viewer/chrome-unavailable`，`severity: 'warning'`，`supportedFixes` 为 `set ARCHIFY_CHROME to a Chrome or Chromium executable and rerun browser-check`。
- 同时写出 `<output-stem>.browser-check.json` 侧车（`status: 'skipped'`）+ `<output-stem>.finalize.json` / `.finalize-summary.json`（`finalize.mjs:889` 的 `persistReceipts()` 在 break 后仍执行）。

即：**"产物成功、命令失败"**。`references/delivery-contract.md:409-410` 对这一点的表述是：

> Runtime failures leave incomplete evidence and must not be normalized to `skipped`. They do not invalidate an already successful deterministic delivery.

### 2.6 找到 Chrome 但启动失败：fail（exit 1），不是 skip

异常兜底在 `visual-check.mjs:2610-2646`：

```js
  } catch (error) {
    const startupTimeout = error.code === 'ERR_CHROME_CDP_TIMEOUT'
      && error.method === 'Target.getTargets';
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = error.message;
    receipt.containment.status = 'fail';
    ...
    receipt.diagnostics = error.archifyDiagnostics || [failureDiagnostic({
      code: startupTimeout ? 'viewer/chrome-startup-timeout' : `viewer/${command}-runtime`,
      ...
    })];
    return {
      exitCode: EXIT.fail,
      ...
```

- 这类失败码是 `1`（fail），`finalize` 相应为非 0 → 遵循 `SKILL.md:42`"A non-zero exit is never success"。
- **超时窗口很长**：`visual-check.mjs:55` → `export const CHROME_STARTUP_TIMEOUT_MS = 90000;`，用于首个 CDP 调用（`visual-check.mjs:1562-1563` `Target.getTargets`）。Chrome 若是"能启动但握手不返回"，browser-check 最坏可挂约 90 秒。单条 CDP 请求的超时是 15s（`visual-check.mjs:1427` `timeoutMs = 15000`）。
- 启动失败诊断明确劝阻乱改产物（`visual-check.mjs:2623-2627`）：`do not edit or simplify the artifact because this is a browser-startup failure`。

### 2.7 CDP 连接方式：**只连自己 spawn 的 Chrome，不连已存在的浏览器**

- 传输是 `--remote-debugging-pipe`（`visual-check.mjs:1487`），即通过子进程 `stdio[3]`(写) / `stdio[4]`(读) 的 NUL 分隔 JSON 管道通信——`visual-check.mjs:1361-1363`：

```js
    this.writePipe = child.stdio[3];
    this.readPipe = child.stdio[4];
```

- spawn 时显式给了 5 个 stdio 槽（`visual-check.mjs:1534`：`{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }`）。
- **全包 grep 结果**：`remote-debugging-port` 在 1.0.0 的所有 `.mjs` 中出现 **0 次**（`bin/*.mjs`、`scripts/*.mjs` 逐文件计数均为 0）。同样**不存在** `CDP_URL`、`CDP_ENDPOINT`、`CHROME_DEBUG_URL`、`browserWSEndpoint`、`ws://`、`debugPort`、`browserURL` 之类的端点配置。
- 结论：**没有任何"连接到已运行浏览器"的能力**。它必然自己 launch 一个 headless Chrome 子进程，进程结束即 `close()`（`visual-check.mjs:2653-2655` `finally { if (browser?.close) await browser.close(); }`）。

### 2.8 能否禁用单个阶段 / 关掉整个检查 —— **没有这个开关**

穷举证据（全包 grep）：

- 所有 `ARCHIFY_*` 字面量：`ARCHIFY_BRAND_ALLOW_PRIVATE`、`ARCHIFY_BRAND_CAPTURE_TIMEOUT_MS`、`ARCHIFY_CHROME`、`ARCHIFY_CHROME_NO_SANDBOX`、`ARCHIFY_DIAGNOSTIC_FORMAT`、`ARCHIFY_OPEN_TARGET`、`ARCHIFY_PROBE_IDENTITY_CHANGED`、`ARCHIFY_PROBE_MISSING`、`ARCHIFY_QUALITY_PROFILE`、`ARCHIFY_REPO_ROOT`、`ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE`、`ARCHIFY_UPDATE_CACHE_DIRECTORY`、`ARCHIFY_UPDATE_CHECK_DISABLED`、`ARCHIFY_UPDATE_RELEASE_PATH`。
  - 其中与浏览器相关的只有 `ARCHIFY_CHROME`（**改指向**，不是关闭）与 `ARCHIFY_CHROME_NO_SANDBOX`（加 `--no-sandbox`）。
  - `ARCHIFY_UPDATE_CHECK_DISABLED` 只关掉**出站更新检查**，与浏览器无关。
- `skip-browser` / `no-browser` / `skipBrowser` / `--browser` 等模式全包 grep：**NONE FOUND**。
- `finalize` 的完整 CLI 选项（`v1/.../bin/archify.mjs:2181`）：

```
archify finalize <type> <input.json> <output.html> [--json] [--receipt path] [--out-dir <dir>] [--quality standard|showcase] [--repo-root path] [--candidate-sha256 hex]
```

  没有 skip/disable 类选项。
- 环境变量开关同理不存在：除 `ARCHIFY_CHROME` 外的任何变量都不会让 `browser-check` 有不同行为。

**唯一能找到的"强制跳过"手段（非官方、且无收益）**：把 `ARCHIFY_CHROME` 设为空串。因 `visual-check.mjs:1314` 用的是 `hasOwnProperty`（而非真值判断），空串会进入该分支，而 `executable('')` 在 `visual-check.mjs:1284` 直接 `if (!file) return null;` —— 已实测 Node 语义确认 `ARCHIFY_CHROME=` 时 `process.env.ARCHIFY_CHROME === ''` 且 `hasOwnProperty === true`。结果与"没装 Chrome"完全相同：skip → `finalize` 退出码 2、`ok:false`。**这不是一个能拿到成功 receipt 的开关，不应作为方案推荐。**

### 2.9 文档声明与实现是否矛盾

`SKILL.md:40`：

> A passing receipt proves the included `validate`, `deliver`, strict `check`, and real-browser `browser-check` gates passed.

**不矛盾。**因为 skip 会让 `finalize` 非 0，根本不会产生"passing receipt"。skip 时 compact summary 的 `gates.browser-check === 'skipped'`、`ok:false`，`SKILL.md:109` 也要求输出 `browser-evidence status` 与真实 `visual-review status`。

`references/delivery-contract.md:261-264` 亦一致：

> `finalize` invokes verified `deliver` once, reuses its embedded showcase validation result, then runs strict `check --require-provenance` and `browser-check --require-provenance`. It stops at the first failed or skipped stage and preserves that stage's full receipt.

**真正的实际风险不是文档矛盾，而是 agent 行为环路**：`SKILL.md:32`（"run `finalize` directly"）+ `SKILL.md:42`（"A non-zero exit is never success… rerun the complete finalize command"）组合起来，会让 agent 在无 Chrome 环境下反复重跑一个**产物层面无可修**的失败，并把"HTML 已生成且确定性检查全过"这一事实误报为失败。这是升级到 1.0.0 后需要向 agent 交代清楚的点。

---

## 3. SSH / 无本地显示场景的实际后果

### 3.1 会不会弹窗？——不会，任何机器上都不会

`--headless=new` 是硬编码的（`visual-check.mjs:1486`），且没有任何有头开关。**headless 不创建窗口**，因此：
- 不会在远端机器弹窗；
- 不会在用户本地机器弹窗；
- 不需要 `DISPLAY` / Wayland / Aqua 会话。

"SSH 导致弹窗或 GUI 失败"这一担忧不成立——这个检查从设计上就是无界面后台进程。

### 3.2 三种实际结果

| 情形 | 行为 | `finalize` 结果 |
|---|---|---|
| 远端机器没有 Chrome/Chromium | `findChrome` 返回 null → `browser-check` 阶段 `skipped`（exit 2） | **失败**：exit 2、`ok:false`、`status:'skipped'`；HTML 已生成 |
| 有 Chrome，能正常 headless 启动 | 全部视口/主题/可读性测量执行 | 全绿时 exit 0、`ok:true` |
| 有 Chrome，但启动/握手失败（缺共享库、`/dev/shm` 太小、被策略拦截等） | `viewer/chrome-startup-timeout` 或 `viewer/browser-check-runtime` | **失败**：exit 1；最坏挂约 90s（`CHROME_STARTUP_TIMEOUT_MS`） |

无本地显示**不影响**判定：它不需要显示服务；反过来，即便有显示服务，它也仍然只跑 headless（不会"顺带"用上本地 GUI Chrome）。

### 3.3 本机（当前 SSH 会话）实测

本次审计所运行的机器就是通过 SSH 访问的，实测结果如下：

```
$ uname -a
Darwin lumevm.local 25.3.0 Darwin Kernel Version 25.3.0 ... arm64
SSH_TTY=/dev/ttys002   SSH_CONNECTION=1   DISPLAY=unset     # ← 确认是 SSH 会话，无 DISPLAY

$ ls -d "/Applications/Google Chrome.app"
/Applications/Google Chrome.app
$ test -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" && echo "X_OK: executable"
X_OK: executable

$ ls -d /Applications/Chromium.app
ls: /Applications/Chromium.app: No such file or directory
$ command -v google-chrome / chromium / chromium-browser / chrome
(全部 not found)

$ node -v
v24.16.0        # 满足 package.json engines: ^22.19.0 || >=24.0.0
```

**`findChrome` 在本机会命中**：检测顺序是 `ARCHIFY_CHROME`（未设置）→ darwin 固定路径第一条 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`（`visual-check.mjs:1322`），该文件存在且 `X_OK`。故本机**不需要** `ARCHIFY_CHROME`。

本机 headless 启动实测（直接调用系统 Chrome 二进制，**未执行任何包内代码**）：

```
$ "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --no-first-run --no-default-browser-check --user-data-dir=<tmp> --dump-dom about:blank
exit=0
stdout: <html><head></head><body></body></html>
stderr: [76200:...:ERROR:components/os_crypt/common/keychain_password_mac.mm:112] Keychain lookup failed:
        ... errSecInteractionNotAllowed ... (-25308)
```

- **exit 0，DOM 正常返回** → headless Chrome 在这个 SSH 会话中**可以启动并渲染**。
- stderr 的 Keychain 报错是 SSH 无 GUI 会话下的常见噪声（无法访问 Security Server），**非致命**：进程正常完成，且 Archify 的 driver 只消费 CDP 管道，不依赖 Keychain。

因此对**这台机器**：SSH 不构成障碍，`finalize` 的 `browser-check` 有条件通过。

### 3.4 可用的开关与真实取舍

**能改指向**：`ARCHIFY_CHROME=/path/to/chrome`（`visual-check.mjs:1314-1316`）。
**能关出站检查**：`ARCHIFY_UPDATE_CHECK_DISABLED=1`（`delivery-update.mjs:51`）。
**能关浏览器阶段**：**没有这个开关**（见 §2.8）。

在无法提供 Chrome 的环境里，保留能力的**唯一正当做法是绕过 `finalize` 这个包装器**，直接跑它内部那条确定性链路——`finalize` 本身就只是 `deliver` → `check` → `browser-check` 的编排：

- `archify deliver <type> <input.json> <output.html> [--quality ...] [--json]`（`archify.mjs:2180`）：渲染 + 原子提交 HTML，**内含 validate**（`finalize.mjs:795-809` 显示 deliver 收到的是 embedded validate 结果），且同样带 `update` 检查（`SKILL.md:46`）。
- `archify check <output.html> --require-provenance`（`archify.mjs:2186`）：严格 provenance 校验。
- 二者都**不启动 Chrome**，覆盖了四个 gate 里的三个。缺的只有 `browser-check` 的浏览器证据；此时应按 `SKILL.md:88` 如实声明"浏览器证据 = skipped"，不得声称视觉验证过。

注意：`deliver` 的 `--open` 才是打开系统浏览器（`open-artifact.mjs` 的 `open`/`xdg-open`），默认不开；`preview` 是 `--no-open` 可选。这条路径不需要 Chrome。

---

## 4. 能否经 cockpit 用上？——**不可行**

### 4.1 cockpit 的能力是什么

`cockpitBridge.forwards` 是**把运行 DSH 那台机器上的某个本地端口，发布给用户设备侧的浏览器**。接口定义见 `packages/cockpit-memex-browse-shim/src/client/index.ts:10-13`：

```ts
interface CockpitForwardsService {
  acquire(devicePort: number, holder: string): Promise<ForwardHandle>
  release(handle: ForwardHandle): Promise<void>
}
```

其用途在 `packages/cockpit-memex-browse-shim/README.md:6` 说得很清楚：

> When dsh-memex runs on another machine, its "open cards" button would point your browser at a `localhost` address that is not the memex host. This shim makes the button use the port forward that dsh-cockpit publishes, so the card browser opens at an address that really reaches the device.

即：**为"人类浏览器访问远端 HTTP 端口"服务**（`acquire(devicePort, …)` → 给你一个 `address.url`）。它转发的是 **TCP 端口**。

### 4.2 为什么对 browser-check 无用

`browser-check` 需要一个 **CDP 端点**才可能被重定向到别的浏览器，但：

1. 它用 `--remote-debugging-pipe`（`visual-check.mjs:1487`），传输是**子进程 stdio 管道**，不是 TCP 端口——没有端口可供转发。
2. 全包 `remote-debugging-port` 出现 0 次；无 `CDP_URL` / `CHROME_DEBUG_URL` / `browserWSEndpoint` 等端点变量（§2.7）。
3. 因此 `finalize`/`browser-check` **不暴露、也不消费任何可被转发的接口**。cockpit 的端口转发没有任何可对接的 socket。

**明确结论：不可行。**"本机 Chrome + 端口转发 + CDP endpoint" 这条思路的前提（存在可配置的 CDP endpoint）在 1.0.0 中不存在，属于空想方案，不予推荐。任何试图拼凑的方案都要求修改包内代码——那就不再是"用官方 1.0.0"，而是自建 fork，超出本审计范围。

### 4.3 cockpit 唯一沾边的正当用途（与 browser-check 无关）

如果目标只是"在本地浏览器里**看**生成的 HTML"（而不是让 browser-check 通过），端口转发思路是成立的，因为那是纯粹的 HTTP 查看：

- `archify preview <type> <input.json> [output.html]` 会起一个 HTTP 服务（`bin/preview.mjs:432` `http.createServer(...)`），但**绑定 loopback 且端口随机**：`preview.mjs:509` `server.listen(0, loopbackHost, ...)`，`preview.mjs:23` `const loopbackHost = '127.0.0.1';`，URL 由 `preview.mjs:521` 拼出。端口是 `0`（内核分配），cockpit 需要显式 `devicePort`，只能在拿到实际端口后再 `acquire`——有可行性但属于额外工程，且**完全不影响 `finalize` 的 exit code**。
- 这解决的是"看"，不是"让 browser-check 通过"。请勿混淆。

---

## 5. 与 0.1.0 的对比：升级影响面

### 5.1 0.1.0 没有 `finalize`，浏览器检查是可选步骤

0.1.0 解包后的文件清单里**完全没有** `bin/finalize.mjs`、`bin/delivery-update.mjs`、`scripts/check-update.mjs`：

```
v0/package/skills/archify/bin/          → archify.mjs, open-artifact.mjs, preview.mjs, visual-check.mjs
v0/package/skills/archify/scripts/      → check-render-output.mjs, render-examples.mjs
```

`v0/package/skills/archify/SKILL.md` 中 `finalize` 出现次数：**0**。

0.1.0 的验收链是 `deliver` 一次成功即完成（`v0/SKILL.md:83`）：

> Use `validate` during repair and `deliver` once for final acceptance.

浏览器证据是其后**额外**的一步（`v0/SKILL.md:85-91`）：

> After delivery, collect bounded desktop evidence without modifying or rerendering the trusted HTML:
> ```bash
> node bin/archify.mjs visual-check <output.html> --json
> ```
> … Exit 0 means containment and captures passed, 1 means overflow or capture failure, and 2 means Chrome/Chromium was unavailable and the receipt is `skipped`. The command never changes the delivered HTML.

**0.1.0 里没有 Chrome 的代价 = 一句 `skipped`，不影响交付成功。**

### 5.2 0.1.0 **也有**同一套 Chrome 引擎，只是非强制

0.1.0 的 `visual-check.mjs` 与 1.0.0 的发现/传输逻辑基本一致：

- `v0/.../bin/visual-check.mjs:20`：`const EXIT = Object.freeze({ pass: 0, fail: 1, skipped: 2 });`
- `v0/.../bin/visual-check.mjs:103-104`：`ARCHIFY_CHROME` 覆盖（同样是 `hasOwnProperty`）。
- `v0/.../bin/visual-check.mjs:111-112`：darwin 固定路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、`/Applications/Chromium.app/Contents/MacOS/Chromium`。
- `v0/.../bin/visual-check.mjs:239-240`：`--headless=new`、`--remote-debugging-pipe`。
- `v0/.../bin/visual-check.mjs:451-456`：找不到 Chrome → `status='skipped'`、`return { exitCode: EXIT.skipped, receipt }`（0.1.0 这里只有 `containment`/`captures` 两组状态，1.0.0 增加了 `readability`/`viewerChrome`/`themeStates`）。

即：**Chrome 相关行为（headless、pipe、`ARCHIFY_CHROME`、skip-on-missing）在 0.1.0 就存在**；1.0.0 的变化是**把它变成 `finalize` 的强制阶段**，从而把"Chrome 缺失"从"一条 skip 证据"升级为"主命令非 0"。

### 5.3 升级到 1.0.0 后"能否只关掉浏览器那一步而保留其余能力"

**不能通过配置做到。**没有单阶段禁用开关（§2.8）。两个可达选项：

1. **保留全部能力**：在 `finalize` 之外接受"没有浏览器证据"，改用 `deliver` + `check`（§3.4）。这会失去 1.0.0 的编排、receipt 合并、`visualReviewRecommendation` 等便利，但拿到具名、可审计的确定性交付。
2. **保留 `finalize`**：就必须让 Chrome 可用（本机已具备，无需 `ARCHIFY_CHROME`），否则每次 `finalize` 都会以 exit 2 结束。

顺带：升级还会**新增出站 HTTPS**（0.1.0 无 `check-update.mjs`/`delivery-update.mjs`，即无任何更新检查）。可用 `ARCHIFY_UPDATE_CHECK_DISABLED=1` 关闭。

### 5.4 CHANGELOG 表述的准确性

`v1/package/CHANGELOG.md:9`（1.0.0 条目）：

> Preserves the Skill-only activation contract: one `archify-plugin` provider, no native tools, dependencies, install hooks, telemetry, or automatic updates.

- "no telemetry"：**成立**——请求只是对一个公开静态 JSON 的匿名 `GET`，无标识、无内容上行（§1.2）。
- "no automatic updates"：**成立**——只通知，不下载/不安装/不执行（`update-awareness.md:12`）。
- 但需要注意它**不意味着"无出站请求"**：这次 1.0.0 新增了一条周期性 HTTPS 出站检查（24h TTL）。措辞上不矛盾，但"无出站"的直觉预期需要修正。

---

## 6. Uncertain / 未确定项

以下事项本次**未能确定**，不应作为结论使用：

1. **未执行任何包内代码。**`findChrome`、`runBrowserCheck`、`startUpdateCheck` 的行为均来自逐行代码阅读；本机实测只验证了"系统 headless Chrome 可启动"与"Node 空串环境变量语义"，**没有端到端跑过 `finalize`**，因此：
   - 未实测 `ARCHIFY_CHROME=""` 触发的 skip 路径（结论由 `visual-check.mjs:1314` + `:1284` 的代码语义推出，标注为"代码可证、未运行时验证"）。
   - 未实测 `viewer/chrome-unavailable` 时产生的 sidecar 文件名/字段全集。
2. **未联网请求 `https://tt-a1i.github.io/archify/skill-updates/archify/stable.json`。**因此不知道当前远端清单内容、最新版本号、是否正有 `severity: "security"` 通告。
3. **未在 Linux 服务器上验证。**本机是 macOS（`lumevm.local`）。Linux 下 `findChrome` 只查 `PATH` 上的 `google-chrome`/`google-chrome-stable`/`chromium`/`chromium-browser`（`visual-check.mjs:1335`），**不查任何发行版特定路径**（如 `/usr/bin/chromium` 软链通常存在，但 snap/flatpak 打包的 Chrome 未必落在 `PATH`）；Linux 容器缺 `libnss`/`/dev/shm` 等导致的启动失败也未实测。
4. **`ARCHIFY_UPDATE_CHECK_DISABLED` 在 DSH 宿主路径下是否会被透传**未确定。`finalize.mjs:699` 用的是传入的 `env`（默认 `process.env`），所以理论上宿主进程环境里的该变量会生效；但本仓库如何把环境变量注入 skill 子进程（DSH 的 skill 执行环境）未审计——如需保证生效，应确认 DSH 侧进程环境。
5. **cockpit 的 `devicePort` 与 `preview` 随机端口的结合**（§4.3）只是接口层面的可行性推断，未实现、未验证。
6. **`doctor` 不检测 Chrome**（`commandDoctor` 内 grep `chrome|browser` 无命中，仅检查文件存在性与 Node 版本），因此 `archify doctor` **不能**用来预判 `browser-check` 是否会 skip。这一点已确认，但意味着无现成的体检手段 —— 列为**已确定**，此处仅作提示。
7. 未审计 1.0.0 与 DSH `0.1.2-rc.1` 宿主契约的兼容性（本仓库当前 DSH 版本、`cordis.patch.yml` 的适配）——超出本次三个问题的范围。

---

## 7. 一句话结论

- **出栈**：24 小时一次的匿名 `GET` 静态版本清单，纯"有新版本"提示，无标识上行、4s 上限、失败无害，可用 `ARCHIFY_UPDATE_CHECK_DISABLED=1` 关闭。
- **SSH**：Chrome 永远 headless，**不会弹窗**；本机 Chrome 存在且实测 headless 可启动，所以本机 SSH 下可用；没装 Chrome 的机器上 `finalize` 会以 exit 2 结束（HTML 仍已生成），且**没有关闭浏览器阶段的开关**。
- **cockpit**：**不可行**——archify 只走 `--remote-debugging-pipe`，不暴露 CDP 端口，端口转发无从对接。
