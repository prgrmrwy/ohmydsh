## 1. 插件包骨架与 manifest 条目

- [x] 1.1 新建 `packages/dsh-subscriptions-sandbox-shim/`:package.json(声明 `dsh.bundle { patch: "./cordis.patch.yml" }`、独立版本 0.1.0、peerDependencies 含 `@deepseek-ai/cordis` / `@deepseek-ai/dsh-llm` / `@deepseek-ai/schemastery`、构建脚本与上游同款 tsc+tsdown 或等价产物)、`cordis.patch.yml`(一行注册插件)、`src/`、`CHANGELOG.md`
- [x] 1.2 `dsh.yaml` 新增定制条目 `id: subscriptions-sandbox-shim, type: package, source: local, version: 0.1.0, enabled: true`,note 注明部署形态约束(仅限 danger-full-access + approval: never;受限部署必须禁用)与上游 issue #7 关联
- [x] 1.3 包内 README 写明:作用范围默认 codex/grok、两层剥离语义、受限部署禁用要求、上游修复后移除路径

## 2. 核心实现(全部收敛到单一 llm 内部访问模块)

- [x] 2.1 实现 `stripSchema(options)`:provider 命中且工具 schema 含两键时返回克隆请求(仅 tools 数组与命中的 parameters 为新对象,其余字段复用原引用),否则返回原对象;`callConfigEquals` 不受影响
- [x] 2.2 实现 `stripChunks(stream)`:async generator 包装,仅重写 `block-end` 且 `block.type === 'tool-call'` 的 chunk——`JSON.parse(arguments)` 删除 `sandbox_permissions`/`justification` 后回写,解析失败或未变化原样透传;不触碰 `tool-call-delta`
- [x] 2.3 实现适配器包装:`llm/adapters-updated` 事件触发时对配置内 provider 取 `ctx.llm.registration(provider).adapter`,WeakSet 幂等包装其 `stream`(保留 `this` 绑定,`for await` 委托 return 语义);配置 schema:`providers` 默认 `['codex','grok']`、`stripSchema`/`stripOutput` 默认 true
- [x] 2.4 插件入口:注册配置、订阅 `llm/adapters-updated`、dispose 时解除监听(包装随适配器实例生命周期,不残留)

## 3. 测试

- [x] 3.1 单测 `stripSchema`:含两键→剥离且其余不变;不含→返回原对象(引用相等);非目标 provider→原对象
- [x] 3.2 单测 `stripChunks`:arguments 含两键→剥离;非法 JSON→原样;非工具块/非目标 provider→原样;block 形状(index/type/id/name)不变
- [x] 3.3 单测重复包装防护:同一适配器多次 `adapters-updated` 后 `stream` 仍单层包装
- [x] 3.4 会话一致性测试(可用模拟 session 或真实短会话):清洗后的工具调用参数进入持久化消息,resume 派生消息不含两键

## 4. 物化与端到端验收

- [x] 4.1 `node scripts/sync.mjs`(或 `dsh build`)安装新包,确认 `~/.dsh/profiles/web` 中包版本与 manifest pin 一致,`dsh restart` 后插件加载无报错
- [x] 4.2 codex 会话实测:让 GPT 执行 `bash`/`write` 工作区操作,确认不再出现 `not strictly wider`/配对校验报错,工具按 standing policy 成功执行
- [ ] 4.3 deepseek 会话回归:确认其收到的工具 schema 与未装 shim 时一致(含两键),行为无变化
- [ ] 4.4 会话 resume 验收:resume 一个含清洗工具调用的会话,继续对话正常

## 5. 收尾

- [x] 5.1 `BACKLOG.md` D001 条目补充:本 shim 为部署侧缓解,标记可移除条件(上游修复/DSH 升级)
- [x] 5.2 可选:给 `skills/dsh-sandbox-notes/SKILL.md` 补一段"shim 存在时"的说明
