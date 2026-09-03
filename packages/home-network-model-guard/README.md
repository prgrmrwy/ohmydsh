# dsh-home-network-model-guard

家庭网络 × Claude 系列模型发送拦截（DSH 定制包，Host + Web 双半区）。

## 行为

当 **DSH 主机**（不是浏览器所在设备）的公网出口 IP 命中家庭网络白名单，且当前会话选中的是
Claude 系列模型时，该会话的输入框被置为不可发送，并显示本地化原因文案（中/英）。
任一条件不成立、或网络判定不可用（fail open）时都不拦截。

- **网络位置真相源**：Host 经由 loopback Connection RPC（`/dsh-home-network-model-guard`）
  判定，只下发分类结论，不泄漏 IP 原文。
- **缓存**：TTL（5 分钟兜底）+ 本机非 internal IPv4 地址集合指纹；指纹变化即失效重查，
  并发请求 single-flight 合并。
- **外呼**：单一固定端点（`https://ifconfig.me/ip`，超时 5s，首次连接失败时立即重试一次）。
  这是本包唯一的外部网络请求；失败一律 fail open（判定为 unknown，不缓存，下次请求重试）。
  2026-09-03 实测 `api.ipify.org` 在办公网段与家庭网络均被拒（连接被过滤/无响应），
  `ifconfig.me` 两者均可达；端点变更理由见 `src/rules.ts` 注释。
- **家族识别**：同时匹配 provider 路由（`claude` / anthropic）与模型名（claude-*）。
- **与官方共存**：官方 `routable === false` 的拦截让位不覆盖；本包只清除自己写入的 block；
  订阅 block 槽位自检，被官方发布清掉时防抖重新断言。

## 约束

- 这是 **UI affordance，不是安全边界**（官方 ComposerBlocks 定位如此）：devtools、其他客户端或
  CLI 均可绕过。需要真正强制时另走 Host 侧 `llm/stream` waterfall。
- 家庭网络白名单（`src/rules.ts` 的 `HOME_NETWORKS`）为 2026-09-03 家庭网络实测结果
  `115.197.18.69`（8/8 连续查询稳定 + ipinfo 交叉一致）。若运营商日后重编号该线路，
  白名单不命中 → 判定 `not-home`（不拦截），重新测量后更新即可。
- 不持久化 IP、不记录访问历史、不执行命令、不读取凭据。

## 开发

```bash
npm run typecheck   # host(client 两个 tsconfig 均检查
npm test            # vitest:判定纯函数 / 缓存语义 / 并发合并 / blocks 共存
npm run build       # host tsc + client tsdown
```

重启 DSH 后生效；DSH 升级需回归 `conversation.blocks` 并存语义（见 design.md Decisions 4）。