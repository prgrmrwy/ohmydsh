# CHANGELOG

## 0.1.1 (2026-08-19)

- 修复被中断 subagent 的 settlement notice 把子会话末尾 `tool-call` 注入父会话后,subscriptions Responses 翻译器将其误序列化为无配对 `function_call`,导致 Codex HTTP 400 (`No tool output found for function call ...`)。
- 在 adapter 请求边界删除孤立 tool-call/tool-result blocks,不改正常成对历史和非目标 provider。

## 0.1.0 (2026-08-19)

- 初始版本:适配器边界两层剥离(schema 出站 + arguments 入站),provider 路由可配置,默认 `codex`/`grok`。
- 解决 dsh-plugin-subscriptions issue #7 在 `danger-full-access` + `approval: never` 部署下的 `not strictly wider` 反复失败。
