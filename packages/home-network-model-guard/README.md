# dsh-home-network-model-guard

受限地区 × Claude 系列模型发送拦截（DSH 定制包，Host + Web 双半区）。

## 行为

当 **DSH 主机**（不是浏览器所在设备）的出口国家/地区码命中阻断清单（默认 `CN`）或判定未知时，
Claude 系列模型被双层拦截；非 Claude 模型不受影响。

- **网络位置真相源**：Host 经由 loopback Connection RPC（`/dsh-home-network-model-guard`）
  判定，只下发分类结论，不泄漏 IP 原文。
- **双备份 Geo**：两个互为备份的 HTTPS 归属服务读取国家码——主服务失败时切换备用；
  两者都失败 → 未知 → 对 Claude fail-closed，并按指数退避（2s→60s 上限）持续重试。
  自动判定**不**访问 Anthropic/Cloudflare 或任何目标模型的诊断端点。
- **缓存**：TTL（5 分钟兜底）+ 本机非 internal IPv4 地址指纹 + **配置代际**；
  任一变化即失效重查，并发请求 single-flight 合并。
- **双层拦截**：Web 用官方 `conversation.blocks` 提前禁用输入框；Host 在
  `llm/stream` waterfall 处拒绝非 `allowed` 的 Claude 调用（覆盖 CLI/subagent/
  其他绕过输入框的路径），错误不包含 IP/Geo 原文/凭据。拒绝在主机侧留下一行
  去重后的诊断日志（仅分类 + 降级原因），不静默失败。
- **故障转移**：主备端点各有独立超时预算，任一端点的挂起或耗时都不会剥夺另一个
  的尝试机会；单端点预算内对瞬时失败（transport / 非 2xx）至多重试 1 次，
  端点自身超时与确定性坏响应不重试。只有两个端点都失败才判定 `unknown`。
- **家族识别**：同时匹配 provider 路由（`claude` / `anthropic`）与模型名（claude-*）。
- **与官方共存**：官方 `routable === false` 的拦截让位不覆盖；本包只清除自己写入的 block；
  订阅 block 槽位自检，被官方发布清掉时防抖重新断言。

## 临时补偿：被阻断输入框的高度兜底

运行体 0.1.2-rc.1 把 composer 从原生 `<textarea>` 迁到 Lexical contenteditable
时，删除了原先负责撑高的隐藏 mirror（其内容为 `draft + "\n"`，空草稿也占一行），
高度改由 Lexical 产出的 `<p>` 承担，而仅存的 `min-height` 规则只作用于 hero
（首屏居中）态。于是 **block 生效且草稿为空**时没有 `<p>`：内容区高度归零，
绝对定位的原因文案被滚动容器的 `overflow` 裁掉——用户既看不到输入框也看不到原因。

本包为此注入一条兜底（`client/index.ts` 的 `COMPOSER_FALLBACK_CSS`）：

```css
[data-input-scroll] > div{min-height:24px}
```

- 只锚定运行体的稳定 `data-*` 属性，不依赖构建期哈希类名（每次重新构建都会变）。
- 作用于内容区**父级**而非编辑器本身，不与官方 `.hero .input{min-height:52px}`
  争夺同一元素的同一属性。
- 是**下界**而非覆写：24px 等于一行 `line-height`，已有高度的状态（草稿非空、
  hero 态、正常编辑）完全不受影响。

⚠ 这是对运行体缺陷的临时补偿。**当运行体重新为非 hero 态的 composer 内容区提供
最小高度（或恢复等价的 mirror 机制）后，应删除该规则**；验证方式是移除后确认
「block 生效 + 空草稿」仍能显示原因文案。

注：该回归并非本包特有——官方 `ui-model-selection` 在 `routable === false` 时走
同一条 blocked 分支，同样会塌；本兜底无条件生效，顺带覆盖该场景。

## 配置

运行时配置在本机（不进仓库）：

```
$DSH_HOME/plugins/dsh-home-network-model-guard/config.json
```

字段（全部非秘密，写入时拒绝凭据字段/非 HTTPS 端点/URL 内嵌账号）：

- `blockedCountries`: ISO alpha-2 阻断清单（默认 `["CN"]`）
- `geoEndpoints`: 主备两个 HTTPS Geo 端点（默认 `ipinfo.io/json` + `ipwho.is/`）
- `timeoutMs` / `ttlMs` / `backoffBaseMs` / `backoffMaxMs`: 非秘密调参（可选）
  - `timeoutMs` 是**单个端点**的预算（默认 5s），不是整次判定的总预算：主备各自
    独享一份，慢主端点无法吞掉备端点的机会，最坏整体耗时约 `2 × timeoutMs`。

配置缺失/非法 → 使用默认值（阻断清单 `CN`）并保持 Claude fail-closed。
总开关：`dsh.yaml` 中本条目 `enabled: false` → 重新 build 后门禁与 Web 提示全部卸载。

## 信任面

- 只访问配置声明的两个 IP 归属服务（它们可能记录请求 IP）；
- 不访问 Anthropic/Cloudflare 诊断端点；不回传本地信息；不落盘 IP；
- 不保存会话文本/凭据；响应不含原始 IP 与端点。

## 开发

```bash
npm run typecheck   # host + client 两个 tsconfig 均检查
npm test            # vitest:判定/缓存/failover/配置/门禁/共存
npm run build       # host tsc + client tsdown
```

重启 DSH 后生效；DSH 升级需回归 `conversation.blocks` 并存语义与 `llm/stream` 门禁。