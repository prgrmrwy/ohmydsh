# Anvil 独立实施评审

- 日期：2026-11-23（Asia/Shanghai）。
- 上下文：独立子会话从规范、代码、测试建立判断；没有使用实施者的“已通过”结论代替验证。运行时标识为 gpt-6-astra；未核验与实施者是否为不同模型，故不宣称完成跨模型验证。
- 范围：`sidebar-local-service-browser` 已批准 change；只写本报告，不修改源码、规范或测试。允许的 package build 会重建忽略的产物；未安装依赖、部署、重启日常 Host 或执行合入。
- 判定：**IMPLEMENTATION-REVIEW: PASS_WITH_FIXES**。发现 0 Critical、2 Moderate；下列修复及回归完成前，不应把自动化全绿当作验收完成。

## 实际验证

所有命令在绑定 worktree 中执行。以下为评审者实际执行结果，不引用其他会话的成功声明。

| 命令／检查 | 实际结果 |
|---|---|
| `npm --prefix packages/sidebar-local-service-browser test` | exit 0；13 文件、83 测试通过；34.96s，其中长流场景约 30.017s |
| package cwd 下 `npx --no-install vitest run --config vitest.browser.config.ts` | 初次现有产物：exit 0，12 文件、39 测试，23.45s |
| 验证 clean 的绝对目标为本 worktree package 的 lib 后，`npm --prefix packages/sidebar-local-service-browser run build` | exit 0；真实 client/host bundle 与声明构建成功；有 CJS/platform 提示，不是构建失败 |
| `npm --prefix packages/sidebar-local-service-browser run typecheck` | exit 0；host/client/SW 三个配置通过 |
| 重建后再次执行上述 Chromium 命令 | exit 0；12 文件、39 测试，36.09s；无 skip |
| 用 Node 比较规范 Scenario 标题与测试中的精确 `spec Scenario "…"` 字串 | 66 场景，missing=[]；仅证明命名映射齐全，不等同断言完备 |
| 构建开关与产物检查 | [构建配置](../../../packages/dsh-host-browsing/tsdown.config.ts#L32) 的 `ALLOW_PLACEHOLDER_ASSETS_BY_DEFAULT=false`；产物搜索 placeholder 标记无命中；重建后的浏览器行为测试另证明实际脚本运行 |
| HTML scanner 反例（下文 M1） | 正常注释顺序 inject,page；两个非标准但浏览器接受的注释终止形式均为 page,inject |
| preflight 反例（下文 M2） | registration 延迟 5200ms，实际 5202ms 后成功 resolve，没有 5 秒超时 |

反例脚本通过 Node stdin 执行，没有新增测试文件。M1 首次探针使用 package-local TypeScript 文件路径失败（ERR_MODULE_NOT_FOUND）；第二次 Node strip-only 不支持参数属性；改为 Node `--experimental-transform-types` 后执行真实源码成功。M2 使用 `stripTypeScriptTypes` 并将唯一常量 import 替换为同值常量以加载源码。上述两次探针启动失败不计为产品失败。曾尝试读取不存在的独立 HTML 测试文件，随后 glob 确认实际文件是 [host-html.test.ts](../../../packages/dsh-host-browsing/test/host-html.test.ts)。

**未验证／不宣称完成**：真实跨机器 Cockpit + Vite/React Router、连续两次 `dsh build` 幂等、worktree 预览人工验收；这是 [test-plan:88](test-plan.md#L88) 明确保留的门禁。这里的 Chrome harness 使用真实 Host/auth/index 流水线及模拟跨端口 Cockpit 父页，并非真实 SSH 跨机验收。也没有逐一人工审完 122 个测试的每条断言；下文列出已检查的关键断言与缺口。

## 🔴 Critical

未发现经证据确认的 Critical。此结论不是安全隔离保证：已批准的同源信任模型、Worker/嵌套 iframe 限制、浏览器 cookie 不按端口隔离、location.host/origin 保持 DSH，以及停止前已解析脚本可能执行一次，均不作为新缺陷。

## 🟡 Moderate

### M1 — HTML 注释扫描与浏览器解析不同，页面脚本可早于注入执行

**证据**：[html-inject.ts:42–45](../../../packages/dsh-host-browsing/src/host/html-inject.ts#L42-L45) 只寻找 `-->`；找不到时 final 插到整个正文末尾。[spec:261](specs/sidebar-local-service-browser/spec.md#L261) 明确要求注入是文档第一个执行的脚本，[spec:154](specs/sidebar-local-service-browser/spec.md#L154) 要求跳过前导注释后插入。

**已执行反例**：对真实 `injectIntoDocument` 输入下列前缀，各自接一个记录 `page` 的 script；注入 script 记录 `inject`；用 jsdom 的 HTML parser 与 `runScripts:'dangerously'` 执行结果。

```text
<!-- ok -->       => ["inject", "page"]   （正向对照）
<!-->             => ["page", "inject"]
<!-- x --!>       => ["page", "inject"]
```

浏览器 HTML tokenizer 接受后两者结束注释，scanner 却等到 EOF 才注入。页面先读取到代理 pathname、先创建未经包装的 WebSocket 等；这不是“注入已经先运行并 window.stop 后仍可能执行”的已接受例外，而是注入本身放晚了。两个 helper/stream 路径共用该 scanner；反例直接验证的是完整文档 helper，未另跑 Chromium 反例。

**最小修复**：前导注释识别应遵循 HTML comment 的 abrupt close、`--!>` 等终止状态；不确定／未终止 token 的 EOF 不要将可执行注入放进 token 尾部，采用保守插入位置。保持已有流式与内存上限设计，无需全量解析 HTML。增加分块扫描测试，并用真实 Chromium 断言注入 marker 和无前缀 pathname 在页面首脚本之前可见。

**测试缺口**：[host-html.test.ts:18–44](../../../packages/dsh-host-browsing/test/host-html.test.ts#L18-L44) 检查普通 doctype 样本的位置、nonce 与配置，不覆盖上述 tokenizer 分歧；当前 122 测试全绿没有排除它。

### M2 — Service Worker 的五秒 deadline 不包含 register 本身

**证据**：[platform.ts:23–29](../../../packages/dsh-host-browsing/src/client/platform.ts#L23-L29) 先无期限 `await navigator.serviceWorker.register(...)`，随后才开始 5000ms 计时。[spec:435](specs/sidebar-local-service-browser/spec.md#L435) 要求加载前注册成功并在五秒内 active，条件不满足时显示具体原因。

**已执行反例**：保持真实 `browserPlatform.registerServiceWorker` 函数，用注册接口替身在 5200ms 后返回 `{active:{}}`。结果 5202ms 后成功 resolve；如果 register 永不 settle，deadline 分支永远不执行。网络卡住或服务端一直不完成 SW 脚本响应时，用户停在等待态而非得到五秒失败提示。iframe 没有提前加载，所以不是认证绕过，严重性为可用性／合同偏差。

**最小修复**：在调用 register 前启动统一五秒 deadline，让注册 promise 与激活等待共享该期限；超时 reject，并清理计时器。不能取消原生注册时，确保晚到结果不触发本次导航。补“register pending 超时”“注册消耗大部分预算、剩余预算激活”测试；已有 500 响应失败场景不能代替挂起测试。

## 📌 Suggestion

- 保留当前使用真实 Host/auth/index 流水线、正向对照和未缩短 30s 长流的测试方式。为 HTML tokenizer 和挂起 registration 增加边界样本，比继续增加同名 happy-path 更有价值。
- 将最终发布／验收结论与本次实施评审区分；在上述人工门禁有可追溯结果前，不把 PASS_WITH_FIXES 或自动化 green 升格为“全部验收通过”。

## Requirement 对照

判定含义：`consistent` 是已阅读实现及已有运行证据未见偏差，不代表穷尽证明；`deviation` 有具体反例；未执行的环境门禁单独标为 `not verified`。

| Requirement（规范锚点） | 判定 | 依据／边界 |
|---|---|---|
| [地址栏输入解析与显示](specs/sidebar-local-service-browser/spec.md#L3) | consistent | [address.ts](../../../packages/dsh-host-browsing/src/client/address.ts) 从原始输入保留显式 80、限制回环与端口范围；地址栏及 Chromium smoke 通过 |
| [代理请求的认证与来源限制](specs/sidebar-local-service-browser/spec.md#L29) | consistent | [gate.ts](../../../packages/dsh-host-browsing/src/host/gate.ts) 官方拒绝检查在连接前，HTTP 额外严格 Fetch-Site；[host-auth.test.ts:27–71](../../../packages/dsh-host-browsing/test/host-auth.test.ts#L27-L71) 有真实连接计数及合法请求正向对照；WS 跨端口 Origin 也有正反对照 |
| [代理目标限制](specs/sidebar-local-service-browser/spec.md#L65) | consistent | HTTP/WS 固定回环族、范围校验、实时 Host port 自指拒绝、连接超时和长流测试通过；未把不可能由真实监听端口产生的任意数值 mock 当作已证实缺陷 |
| [请求与响应头的凭据处理](specs/sidebar-local-service-browser/spec.md#L88) | consistent | [headers.ts](../../../packages/dsh-host-browsing/src/host/headers.ts) authority hash+fam+port cookie 白名单、Set-Cookie 改写、Origin/Referer 与条件头处理；Node suite 通过 |
| [重定向与外部跳转](specs/sidebar-local-service-browser/spec.md#L131) | consistent | [redirect.ts](../../../packages/dsh-host-browsing/src/host/redirect.ts) WHATWG 解析、回环转换、HTML 转义及 noopener；Host 与导航测试通过 |
| [HTML 注入与传输语义](specs/sidebar-local-service-browser/spec.md#L152) | deviation | M1；正常注入、CSP 有效指令选择、多策略、压缩、状态码与长流已有测试通过，但不覆盖 comment tokenizer |
| [禁止被代理页面注册 Service Worker](specs/sidebar-local-service-browser/spec.md#L203) | consistent | Host 拒绝脚本请求、删除 allowed，注入 register 禁用及旧注册清理；sw-guard 浏览器测试通过 |
| [本插件 Service Worker 改写受控页面的子请求](specs/sidebar-local-service-browser/spec.md#L222) | consistent | [SW 实现](../../../packages/dsh-host-browsing/src/sw/index.ts) 与 [rewrite.ts](../../../packages/dsh-host-browsing/src/sw/rewrite.ts)；浏览器断言根资源、硬编码端口、实际 stopWorker 后恢复、未知 client 502、主页面 controller=null |
| [页面看到直接地址，导航留在代理内](specs/sidebar-local-service-browser/spec.md#L260) | deviation | M1 打破“第一个执行”；常规 assign/replace/reload、原生 form.submit POST、外链、pushState、坏 JSON/结构/配额及表合并已有行为断言通过 |
| [tab 内历史前进后退按条目身份恢复](specs/sidebar-local-service-browser/spec.md#L346) | consistent | entry.key 表、不改应用 state、跨端口回退与未知身份 blank；[index-guard 测试:49–87](../../../packages/dsh-host-browsing/test/browser/index-guard.browser.test.ts#L49-L87) 真流水线两个前后插件、首脚本检查及哨兵正反对照 |
| [页面内 cookie 与存储视图按端口隔开](specs/sidebar-local-service-browser/spec.md#L387) | consistent | [storage.ts](../../../packages/dsh-host-browsing/src/inject/storage.ts) namespaced 兼容视图；cookie 原名、clear 不影响 DSH／身份表有正向对照；不误称安全隔离 |
| [WebSocket 代理](specs/sidebar-local-service-browser/spec.md#L405) | consistent | 精确路由、path 校验、手工握手白名单、head 转发与关闭；真实 WS 登录态／另端口／拒绝与关闭测试通过 |
| [前置条件不满足时失败闭合（尽力而为）](specs/sidebar-local-service-browser/spec.md#L434) | deviation | M2；缺 Navigation、SW 500、未受控只重载一次、marker/WS/身份表未安装与 blank 已有行为验证 |
| [可独立启停与卸载清理](specs/sidebar-local-service-browser/spec.md#L461) | consistent | [client 注册](../../../packages/dsh-host-browsing/src/client/index.tsx#L13-L35) 与 Host effect disposers；缺依赖不注册、在途连接及 worker 卸载 suite 通过；实际部署门禁另列 |
| [test-plan 人工／集成门禁](test-plan.md#L88)（非新增 Requirement） | not verified | 跨机 Cockpit、两次 dsh build、worktree 预览不在本次已执行范围 |

## 关键断言审查结论

不是仅按测试名打勾：认证测试在拒绝后发相同合法请求证明 upstream 计数器工作；未知 client 测试删除 IDB 并真正停止 worker 后验证 502 和两侧无落网请求，另有 direct positive control；index 测试确认两个插件的实际结构行都存在，随后检查 first script 并运行哨兵；身份表失败覆盖 bad JSON、bad shape、填满配额，检查 native WebSocket 保留与 marker 缺失，再用真实 tab 检查 blank；navigation 测试检查 pathname、history 长度、上游 POST 正文和外链提示，而非只断言组件存在。不能据此推导所有边界都已覆盖：M1/M2 正是规范要求没有被现有断言完全约束的反例。

**最终结论：IMPLEMENTATION-REVIEW: PASS_WITH_FIXES**
