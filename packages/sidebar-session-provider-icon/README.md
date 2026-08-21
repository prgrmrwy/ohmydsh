# dsh-sidebar-session-provider-icon

在 DSH Web 侧边栏每个 session 标题前显示该会话**输入框当前选中的模型品牌** logo。模型选择器切换成功后立即更新，不必先发送消息；不干扰官方任务状态点。

Backlog 条目：[B013](../../BACKLOG.md)。设计与取舍见 OpenSpec change `sidebar-session-provider-icon`。

## 数据优先级

1. **即时真相源**：官方 `dsh-client-ui-model-selection` 的 `ctx.modelDirectories.directoryFor(sessionId).store.current`。这是输入框 selector 与 `/model` 命令共享的唯一 per-session state，`session.selectModel` 成功后立即发布 `{ provider, model }`。
2. **历史 fallback**：Host 的 `provider` session-projection 折叠日志 `request/header`，为尚未在本浏览器打开/加载 selector 的历史会话提供最近一次实际请求的品牌。重启不丢，不使用 localStorage。

因此，当前打开 session（包括尚未发送消息的空白 session）按输入框选择显示；冷历史 session 在未加载 selector 前按最后请求显示。

## 架构

| 面 | 实现 |
|---|---|
| Host | `src/provider.ts` 注册 `provider` projection，折叠 `request/header`，只承担冷历史 fallback |
| Client 数据 | 订阅 `ctx.modelDirectories` 的 per-session store；selector 选择优先于 projection fallback |
| Client DOM | `row-locator.ts` 收拢官方行 DOM 知识；`MutationObserver` 只在标题前维护独立 badge span |
| 品牌图 | `src/client/assets/*.svg` 下载后随包落盘；`logos.ts` 先识别已知 provider route，未知 route 再按 model fallback |

## 品牌资产

不手绘 SVG，也不在浏览器运行时访问 CDN：

- DeepSeek（鲸鱼）、OpenAI/GPT（螺旋）、Anthropic、Grok、Kimi、GLM（智谱）、MiniMax、Pi、OpenClaw、Hermes Agent（兼容 `hermas` 拼写）：`@lobehub/icons-static-svg@1.94.0`，MIT；
- OpenCode：`anomalyco/opencode` commit `5e75e5e9901f0d178f425bfb47f1bd46cbe78a59` 的官方 provider SVG，MIT。

品牌判断优先识别已知 `provider` route：例如真实选择 `opencode-go/deepseek-v4-flash` 显示 OpenCode，而不是 DeepSeek；只有未知/通用 route 才按 `model` fallback。未知选择显示中性首字母 fallback。

## UI 边界

- **不触碰官方 `StateDot`**：不替换、不移动、不隐藏；
- 时间、行菜单、拖拽行为保持官方原样；
- badge 是标题前的独立 `<span>`；
- DOM 无法可靠定位时静默降级为不显示，不破坏页面。

## 开发

依赖由仓库根 workspace 统一安装，`lib/` 是 gitignored 构建产物：

```sh
# 在仓库根执行
npm install
npm run typecheck --workspace dsh-sidebar-session-provider-icon
npm test --workspace dsh-sidebar-session-provider-icon
npm run build --workspace dsh-sidebar-session-provider-icon
```

直接运行 `dsh build` / sync 时，也会在安装 local package 前按需生成 `lib/`。

## License

代码 MIT，见 [LICENSE](LICENSE)。品牌资产库/上游仓库许可见上文；各品牌方保留商标权利。
