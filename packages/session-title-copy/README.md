# dsh-session-title-copy

点击 DSH Web 对话区 header 中的**当前会话标题**，复制当前 session id 到剪贴板；标题 hover 显示 pointer 指针与官方 crumb 悬停底色，复制成功出现瞬态「会话 ID 已复制」提示。

## 为什么

开发/调试时常需要当前 session id（引用驾驶舱、脚本、日志排查），官方标题是 `disabled` 按钮且 `cursor: default`，没有取 id 的入口。本插件把标题变成一个「一键复制」入口，零配置、零网络、零 host 端能力。

## 行为

- 点击当前会话标题（面包屑最后一项）→ 复制当前 session id（真相源 = 官方 sessions list 的 `current`，与 [dsh-cockpit-bridge](https://github.com/prgrmrwy/dsh-cockpit) 同一订阅 seam）。
- 祖先面包屑（历史会话标题）行为不变：点击仍打开对应会话，不复制。
- hover 显示 pointer 指针；复制成功在标题下方显示瞬态提示，1.2s 后淡出。
- 安全降级：官方 DOM 结构变化导致无法定位标题时不注入、不报错；剪贴板 API 不可用/被拒时静默；不发起任何网络请求，不读取/上传任何会话内容。

## 机制（升级后需回归）

标题 crumb 官方 `disabled`（抑制全部事件流），且其 React onClick 无条件 `open(summary.id)`。插件：

1. 移除 `disabled` 恢复事件；
2. 在按钮上注册 **capture 阶段** click 监听并 `stopPropagation()`，阻断 React 根委托的 `open()`；
3. `MutationObserver`（`disabled`/`class` 属性 + 子树变更）+ sessions 订阅 → rAF 防抖 reconcile，React 重渲染/重建后幂等重新接线。

DOM 结构知识全部收敛在 `src/client/title-locator.ts`，官方升级改结构时只需修这一个文件（见 openspec change `session-title-copy` 设计 D2/D3）。

## 安装

经 ohmydsh manifest（`session-title-copy`，source: local）启用，`dsh build` 物化；重启 DSH 后生效。卸载/禁用：manifest `enabled: false` + sync，无持久化数据。

## 开发

```bash
npm run typecheck   # host + client 双项目
npm run build       # tsc(host) + tsdown(client bundle)
npm test            # vitest（结构桩，无浏览器）
```

peer 依赖：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-runtime`（仅 web client half）。
