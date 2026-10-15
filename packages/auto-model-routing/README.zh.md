# dsh-auto-model-routing

[English](README.md)

<!-- problem -->
主会话在 AUTO 下按本地同步规则调整推理强度，保留官方 provider/model。默认禁用，会话默认 MANUAL。输入仅取可信 user 文本，不发送给外部分类服务。子会话由配套 skill 指导主 Agent 显式选择，插件不改写子会话。

## 使用

芯片位于 GPT 速度芯片左侧，点击模式按钮切换，箭头展开锚点、当前原因与最近 20 条内存历史。历史重启清空，不保存任务正文。

模式、锚点及待复原义务保存在 `$DSH_HOME/state/auto-model-routing/sessions/`。MANUAL 复原会覆盖旧快照重试，直到实际请求头与官方合成配置均收敛；模型不匹配时等待官方切换。不会探测网络、自动跨 provider 回退或绕过模型门禁。不保证 provider 的缓存命中。

## 开发验证

在仓库根目录安装依赖，再运行：

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

真实 AgentLoop 集成测试使用假的 LLM 流，不访问模型服务。代码扫描只是无外发验证的补充。当前未获现场启用验收，不应把离线测试视为 GUI 验收。

## 移除
<!-- section: removal -->

先切 MANUAL，完成请求并等待复原结束，再将插件 `enabled: false` 并构建。直接卸载仍可能保留 AUTO effort，需用官方模型选择器重新手选。配套 skill 有独立开关，不随主会话模式变化。
