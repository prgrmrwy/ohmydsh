# dsh-subscriptions-sandbox-shim

DSH 部署侧缓解插件:把订阅 provider(默认 ChatGPT/Codex、Grok)工具面上的 sandbox 升级字段(`sandbox_permissions`/`justification`)清洗掉,解决 `dsh-plugin-subscriptions` [issue #7](https://github.com/V1ki/dsh-plugin-subscriptions/issues/7)(`sandbox escalation ... is not strictly wider`)在 `danger-full-access` + `approval: never` 部署下的反复失败。不改 DSH 源码、不改订阅插件本体。

## 作用与语义

两层剥离,均在适配器边界(包装 `ctx.llm` 注册的 adapter 实例的 `stream`):

1. **出站(schema 层)**:发给模型的工具 `parameters` 中删除两个属性——消除 GPT/Codex 误填的诱因;
2. **入站(返回参数层)**:模型返回的工具调用 `arguments`(block-end 收口处)JSON 解析后删除两个键——硬保证,即使模型幻觉出它们也不会导致调用失败;
3. **Responses 历史配对保护**:发送 codex/grok 请求前,删除没有同请求 `tool-result` 的孤立 `tool-call`(以及反向孤立结果)。这专门兜住 DSH 被中断 subagent 的 settlement notice:core 会把子会话最后一条 assistant 内容原样嵌入父会话 user message,其中未执行完的工具调用不应作为父会话 `function_call` 重放。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `providers` | `['codex', 'grok']` | 生效的 provider 路由;`claude` 可加入 |
| `stripSchema` | `true` | 出站剥离开关 |
| `stripOutput` | `true` | 入站剥离开关 |
| `stripHistory` | `true` | 出站 Responses 历史角色/配对保护;若受限部署需要关闭 sandbox 两层剥离,可保留本项 |

示例(manifest 覆盖):

```yaml
- id: subscriptions-sandbox-shim
  name: dsh-subscriptions-sandbox-shim
  config:
    providers: [codex, grok, claude]
    stripOutput: true
```

## ⚠ 部署形态约束

本插件的语义是 **「该部署永不使用 sandbox 升级通道」**。仅在 `danger-full-access` + `approval: never`(或等价地"无合法升级路径")的部署下启用。

在受限部署(`read-only` / `workspace-write` + `approval: ask`)中必须关闭 `stripSchema` 与 `stripOutput`(或禁用整个插件):那里的合法升级重试会被这两层误剥,导致被 sandbox 拒绝的操作无法恢复。`stripHistory` 不涉及 sandbox 权限,可单独保持开启以防 Codex Responses 400。

## 移除路径

本插件是 [BACKLOG D001](https://github.com/deepseek-ai/deepseek-harness) 所述 core 缺陷(组合期静态广告升级 enum + 执行期 strict-wider 检查)的部署侧缓解。上游修复或 DSH 升级消除该缺陷后,应移除本定制(manifest 删除条目 → sync → restart)。

## 开发

```sh
npm test          # node --test test/(纯逻辑单测,零外部依赖)
```

`test/assembler.test.mjs` 会动态引用 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-llm` 验证与 BlockAssembler 的集成;未安装时该用例自动 skip。
