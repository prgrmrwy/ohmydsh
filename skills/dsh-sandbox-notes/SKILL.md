---
name: dsh-sandbox-notes
description: DSH 文件沙箱与权限升级的避坑笔记——sandbox_permissions 参数的正确用法、"not strictly wider" 报错的绕过、策略切换时的注意事项。
whenToUse: 文件/命令操作被沙箱拒绝([sandbox: file access denied ...]),或出现 "sandbox escalation ... is not strictly wider" 报错,或会话策略(approval policy / file policy)发生变化时。
---

# DSH 沙箱避坑笔记(dsh-sandbox-notes)

2026-08-19 实战踩坑记录(core 缺陷 + 绕过方法),避免每个会话重新踩一遍。

## 背景:core 缺陷(未修复,上游追踪中)

`bash` / `write` / `edit` 等工具的 `sandbox_permissions` 参数是**静态广告**的,永远展示 `["workspace-write", "danger-full-access"]`,不随会话当前模式变化。后果:

- 会话已处于 `danger-full-access` 时,携带**任何** `sandbox_permissions` 参数的调用都会失败:
  ```
  Error: sandbox escalation to "danger-full-access" is not strictly wider than this call's current "danger-full-access" mode
  ```
- 报错**不自我纠正**:不提示"请移除该参数",模型会反复踩同一个坑。
- 根因在 deepseek-harness core(工具 schema 静态广告 + 拒绝信息无指引),社区追踪:https://github.com/V1ki/dsh-plugin-subscriptions/issues/7(与 dsh-plugin-subscriptions 插件本身无关,该 issue 是纯 core 问题)。

## 铁律(每次工具调用前默念)

1. **默认不带 `sandbox_permissions` 参数**。当前会话的 file policy 是什么就做什么操作;只有被真实拒绝才考虑升级。
2. **升级的唯一合法场景**:命令返回 `[sandbox: file access denied under <mode> mode]`(真实拒绝)时,重试一次——带**最窄的足够权限**(`workspace-write` 优先,不够再 `danger-full-access`)+ 一句话 justification。不要预判性升级。
3. **遇到 "not strictly wider" 报错 = 移除参数重试**:这说明当前模式已经覆盖所需权限(常发生在策略切换到 danger-full-access 之后),不带任何 `sandbox_permissions` 字段直接重试即可成功。
4. **approval prompts disabled 时永不带**:此时 denial 是终局,升级必被拒。
5. **策略会中途变化**:会话进行中 approval policy(file policy)可能从 `ask` / `workspace-write` 切到 `never` / `danger-full-access`(用户操作)。每次调用前留意 runtime context 快照里的当前策略;带参数的旧习惯在切换后立即失效。
6. 若连续出现同一参数错误,**先停手分析**(读报错、读当前策略),不要原样重试。

## 2026-08-19 事故实例

- 场景:commit push 前 `git status` / `git diff` 连续失败 10+ 次,全部报 "sandbox escalation ... not strictly wider";
- 原因:之前 `dsh build` 被沙箱拒绝后成功升级过一次(danger-full-access),此后所有 git 调用仍携带 `sandbox_permissions` 参数,策略已切到 danger-full-access,任何携带都失败;
- 绕过:所有调用移除 `sandbox_permissions` 字段 → 立即恢复正常;
- 教训:被批准过一次升级 ≠ 后续调用需要带参数;参数只在"被拒→升级"的那一次出现。

## 部署侧缓解:dsh-subscriptions-sandbox-shim(2026-08-19 落地)

- 针对 GPT/Codex/Grok 这类**爱填可选参数**的模型,本仓库新增自研插件 `subscriptions-sandbox-shim`(packages/subscriptions-sandbox-shim):在适配器边界自动剥掉 `sandbox_permissions`/`justification`(出站 schema + 入站 arguments 两层),`danger-full-access` + `approval: never` 部署下 GPT 会话不再踩 "not strictly wider";
- **对 DeepSeek 等原生 provider 零影响**(按 provider 路由精确匹配,默认只作用 codex/grok);
- shim 存在时,本铁律对订阅 provider 仍是正确行为(不带参数),只是不再需要手动处理报错——模型填了也会被剥掉;
- ⚠ shim 仅适用于"无合法升级路径"的部署;受限部署(ask 审批)必须禁用该定制,否则合法升级会被误剥。
