# CHANGELOG

## 0.1.0(2026-08-19)

- 基于 shipped `standard` 复制,唯一差异:追加 `persona-sandbox` 提示段(沙箱铁律:默认不携带 sandbox_permissions;被真实拒绝才升级;遇 "not strictly wider" 移除参数重试;approval disabled 永不带)。
- 背景:DSH core 缺陷(BACKLOG D001)——工具 schema 静态广告 sandbox_permissions,会话处于 danger-full-access 时任何携带都必然失败且报错不自我纠正,导致 agent 反复踩坑(2026-08-19 实测 commit push 连踩 10+ 次)。
