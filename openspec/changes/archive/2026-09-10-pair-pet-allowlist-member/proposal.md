## Why

Pet 飞书 Channel 的允许成员目前只能手工填写 `ou_...`，但普通用户很难取得自己的 app-scoped `open_id`，导致 Bot 已绑定后仍卡在 onboarding。需要在允许成员设置面提供一次有界、可验证的单聊配对流程，由 Pet Host 从真实入站事件中取得发送者 `open_id`，直接完成首位或后续成员授权。

## What Changes

- 在 Pet Settings → Channel →「允许触发的成员」中新增“生成配对码”流程，展示 `/pair xxxx-xxxx` 命令、剩余有效时间、复制、取消和重新生成操作。
- Pet Host 生成随机、单次、短时有效且不持久化的配对码；同一时刻至多存在一个有效配对。
- 已绑定且身份已确认的 Bot 可在正式 Channel 尚未启用、allowlist 为空或默认 workspace 未配置时，为有效配对临时运行既有 `im.message.receive_v1` consumer。
- 配对消息仅接受用户以单聊文本精确发送 `/pair <code>`；匹配成功后从事件读取 `sender.open_id`，原子去重追加到 allowlist，并尽力解析姓名作为非授权性的展示缓存。
- 配对消息不创建 Pet Task、Invocation、chat binding，不参与 workspace 路由，也不打任务表情；完成、取消、过期或失败后，若正式 Channel 未启用则回收 consumer。
- 正确配对成功时由 Host 回复一次确认；已过期的当前配对命令可回复失效提示；错误 code、群聊尝试和其它陌生消息继续静默丢弃。
- 保留手工输入 `open_id` 作为高级兜底，不引入通讯录搜索或群成员导入。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-lark-channel`: 扩展入站订阅生命周期、allowlist onboarding 与未授权消息防线，增加由设置页发起的单聊配对授权流程。

## Impact

- `packages/dsh-pet/src/host/channel/`: 新增配对状态机，复用现有 subscription，并在普通 pipeline 前增加严格受限的配对分支。
- `packages/dsh-pet/src/host/routes.ts`、`src/wire.ts`、`src/client/api.ts`: 增加配对管理 mutation 和脱敏状态视图。
- `packages/dsh-pet/src/client/settings.tsx` 与样式：在 allowlist 面板呈现生成、倒计时、复制、取消、重新生成和成功/失败状态。
- `packages/dsh-pet/test/`: 增加随机码、过期、竞态、订阅复用、消息静默、Host 回执、持久化边界与页面最终一致性测试。
- 不增加第三方依赖，不接触飞书凭据，不改变既有 allowlist 的 `open_id` 授权真相源，也不改变正式 Channel 的 workspace/Task/Invocation 路由语义。
