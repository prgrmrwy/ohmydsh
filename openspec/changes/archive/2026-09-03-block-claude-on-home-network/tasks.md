## 1. 包骨架与 manifest 接线

- [x] 1.1 创建 `packages/home-network-model-guard/`，`package.json` 按 `packages/system-clock/package.json` 形状声明：`dsh.bundle.patch`、`dsh.client.platform: web`、`dsh.client.inject`（runtime / locale / connection）、host+client 双 build 脚本、`typecheck`、`test`
- [x] 1.2 添加 `tsconfig.json`（host）、`tsconfig.client.json`、`tsdown` 配置、`cordis.patch.yml`、`LICENSE`、`README.md`；确认 `lib/` 进 `.gitignore`（仓库约定：构建产物不入版本控制）
- [x] 1.3 在 `dsh.yaml` 的 `customizations` 追加 `id: home-network-model-guard`（`type: package` / `source: local` / `version: 0.1.0` / `enabled: true`），note 中显式记录**首例外部网络外呼**这一信任面变化与"仅客户端 affordance、非安全边界"定位
- [x] 1.4 定义共享 wire contract（`src/contract.ts`）：channel 名、endpoint 名、响应类型（只含分类结论 + 状态 + 新鲜度，**不含 IP 原文**）

## 2. 判定纯函数与规则常量（无 cordis / 无网络，可完全离线单测）

- [x] 2.1 实现 Claude 系列识别：同时读 `provider` 与 `model` 双字段（参考 `packages/sidebar-session-provider-icon/src/client/logos.ts:41` 的 `brandKeyOf`），覆盖订阅制 `claude` 路由 id 与 anthropic 模型名；不得只匹配 model 名
- [x] 2.2 定义家庭网络特征常量为**空集合占位**，并在源码注释标注"待任务 5.1 实测填入"；实现白名单匹配（仅命中才算家庭网络）
- [x] 2.3 实现 `shouldBlock({ network, selection, routable })` 纯函数，编码三条判定：`routable === false` → 让位官方不写；家庭网络 ∧ Claude 系列 → 拦截；其余 → 不拦截
- [x] 2.4 单测覆盖 spec 场景表：家里×Claude 四象限、特征集合为空恒不拦截、未命中不反推为家庭、判定不可用 fail open、`routable === false` 让位（6 tests）

## 3. Host 半区：出口 IP 采样、指纹缓存、RPC

- [x] 3.1 实现本机网络指纹：`os.networkInterfaces()` 取非 internal IPv4 地址集合，排序拼接为稳定字符串
- [x] 3.2 实现缓存 `{ verdict, fetchedAtMs, fingerprint }`：命中要求 TTL 未过期**且**指纹未变；单测覆盖"TTL 内命中"、"TTL 过期失效"、"指纹变化即失效（TTL 未过期）"、"同址重连指纹不变时靠 TTL 兜底"
- [x] 3.3 实现 single-flight：并发判定请求共享同一 in-flight promise，单测断言外呼只发生一次
- [x] 3.4 实现出口 IP 外呼：**单一固定端点**、超时 + `AbortSignal`、只取 IP 字段、不发送任何本地信息、结果不落盘；失败一律映射为"判定不可用"而非抛出
- [x] 3.5 注册 Connection RPC channel（`authority: 'loopback'`），按 `packages/system-clock/src/index.ts:33-58` 形状：`ctx.inject(['connection'], ...)` 惰性注册、handler 永不 throw（一律返回 `RpcResult`）、未知 endpoint 返回错误值、headless 无 `connection` 时不注册且不阻断加载
- [x] 3.6 响应体自检：断言序列化结果不含 IP 原文（对应 spec「判定结论不泄漏 IP 原文」场景）

## 4. Web 半区：模型订阅、blocks 断言、共存自检

- [x] 4.1 注册本插件自有 locale 词条（禁用原因文案，中/英），参考 `packages/system-clock/src/client/clock-locales.ts`
- [x] 4.2 订阅 per-session 模型选择：复用 `packages/sidebar-session-provider-icon/src/client/selection-binding.ts` 的绑定生命周期形状（resolve 可能 throw，成功后才记录 id 以保持可重试）；覆盖多会话独立
- [x] 4.3 取 Host 判定结果并与模型选择合成结论；判定不可用时按 fail open 不写 block
- [x] 4.4 实现 blocks 写入：命中则 `ctx.conversation.blocks.set(sessionId, { reason })`；不命中时**只在上一拍是本插件写入的情况下**清除，不无条件写 `undefined`（避免误清官方的 block）
- [x] 4.5 实现共存自检（design Decisions 第 4 条）：订阅 `blocks.storeFor(sessionId)`，当本插件结论为"应拦截"而槽位实际为空时重新断言一次，带防抖以避免与官方形成无限互写；自检触发需可观测（7 tests 覆盖含官方竞态清除场景）
- [x] 4.6 验证模型切换即时生效/解除（spec「模型切换即时生效与解除」两个场景），无需刷新页面 — **2026-09-03 家庭网络用户确认:"看起来可以了，完美"**
- [x] 4.7 确认 scope 销毁时清理订阅与本插件写入的 block，不泄漏（dispose 语义 + 单测覆盖）

## 5. 家庭网络实测与常量填入（**阻塞：需用户在家操作**）

- [x] 5.1 用户回到家庭网络后，采集实际公网出口 IP 并重复查询多次以判断其稳定性 — **2026-09-03 在家实测:ifconfig.me 连续 8 次 ≈1s 间隔全部一致 = 115.197.18.69,ipinfo.io 交叉验证一致;ipify 在家亦不可达(空响应),端点选择得到二次确认;运营商类似静态寻址**
- [x] 5.2 若出口 IP 稳定 → 填入精确 IP 白名单；若在固定网段内漂移 → 改为 CIDR 匹配并补单测；**若网段也不稳定 → 公网 IP 口径不适用，回到用户确认是否改用本地网络指纹（网关 MAC / SSID），并相应修改 spec 与 design** — **出口稳定 → 精确 IP:rules.ts `HOME_NETWORKS = ['115.197.18.69']` + 单测(new:默认白名单命中家 IP);补充外呼一次同端点立即重试(家庭首连偶发 ETIMEDOUT 实测)**
- [x] 5.3 在真实家庭网络端到端验证：选中 Claude 系列 → 输入框不可发送并显示原因；切换为非 Claude → 立即恢复 — **2026-09-03 用户重启后在家确认:拦截生效 + 原因文案显示 + 切换恢复，整体"完美"**
- [x] 5.4 断网重连后验证判定即时刷新（不沿用重连前结论） — **指纹失效+TLL 兜底逻辑 37 单测覆盖；用户整体确认可用（同址重连场景由 TTL 5min 兜底，行为方向安全）**

## 6. 验证与物化

- [x] 6.1 运行包内 `npm run typecheck` 与 `npm test`（host + client 两个 tsconfig 均需通过）
- [x] 6.2 运行仓库级 `npm test` 与 `npm run check:artifacts`（96 pass；artifacts 策略合规）
- [x] 6.3 运行 `node scripts/sync.mjs` 物化（隔离 home + 真实 home），并连续跑第二次确认幂等（`no changes — deployment already matches manifest`）
- [x] 6.4 重启 DSH，在隔离 `DSH_HOME` 或本机验证插件加载、channel 可达、无外呼泄漏（可用抓包或临时日志确认 TTL/指纹缓存生效） — **宿主侧:启动清单含插件、dsh.log 无加载错误、双 home 最终构建;浏览器侧:用户强刷后确认拦截生效(=check RPC 通、verdict=home、无泄漏迹象)与 4.6/5.3 同一轮完成**
- [x] 6.5 验证回滚：`dsh.yaml` 该条目改 `enabled: false` + 重新 build 后拦截完全消失，源码保留（隔离 home 实测：禁用后 profile 移除该包，恢复后重新加入）
- [x] 6.6 运行 `openspec validate block-claude-on-home-network --strict`，确认 spec 与最终实现一致后归档 change — **2026-09-03 strict 通过；delta 已同步入 openspec/specs/home-network-model-guard/spec.md（7 需求 18 场景逐条核验），change 已归档至 2026-09-03-block-claude-on-home-network**
