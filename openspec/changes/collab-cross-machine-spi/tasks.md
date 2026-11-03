## 1. 准备与夹具

- [ ] 1.1 新建 `packages/collab-cockpit-shim` 包骨架（package.json、tsconfig、vitest 配置），沿用 dsh-collab 的构建方式；不含实现
- [ ] 1.2 打包提交 `743557e5` 的 collab-kernel 为旧内核夹具并记录 sha256；录制本机行为快照夹具（固定时钟、cmdId、投递顺序）
- [ ] 1.3 编写 kernel 内存测试传输与 shim 的 `cockpitRelay` 替身、可推进测试时钟；运行现有全部测试确认基线为绿

## 2. kernel：runtime 注册表与连接 SPI

- [ ] 2.1 Write failing tests in `packages/collab-kernel/test/runtime-registry.test.ts`: 「注册、列出与连接」；「非法与保留 id」；「替换注册使旧代调用失败」；「保留 channel 不能被 provider 占用」；「注销后不可连接」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 2.2 Implement「runtime 注册表与连接 SPI」使 2.1 通过（规范见 specs/collab-kernel/spec.md，做法见 design.md）
- [ ] 2.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 3. kernel：成员地址带 runtime 且兼容旧绑定

- [ ] 3.1 Write failing tests in `packages/collab-kernel/test/runtime-address.test.ts`: 「旧日志成员按 self 解释」；「远端成员的写入形式」；「旧托管成员与远端身份不碰撞」；「旧托管成员不走远端投递」；「保留 id 与不合规远端地址被拒」；「纯本机空间可被旧内核读取」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 3.2 Implement「成员地址带 runtime 且兼容旧绑定」使 3.1 通过（规范见 specs/collab-kernel/spec.md，做法见 design.md）
- [ ] 3.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 4. kernel：跨机错误分层

- [ ] 4.1 Write failing tests in `packages/collab-kernel/test/runtime-errors.test.ts`: 「远端认领不可达」；「远端拒绝认领」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 4.2 Implement「跨机错误分层」使 4.1 通过（规范见 specs/collab-kernel/spec.md，做法见 design.md）
- [ ] 4.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 5. kernel：远端成员的唤醒经其 runtime 投递

- [ ] 5.1 Write failing tests in `packages/collab-kernel/test/runtime-wake.test.ts`: 「远端 presence 与投递方式」；「远端唤醒成功与失败」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 5.2 Implement「远端成员的唤醒经其 runtime 投递」使 5.1 通过（规范见 specs/collab-kernel/spec.md，做法见 design.md）
- [ ] 5.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 6. dsh-collab：本机 runtime 作为 self 提供

- [ ] 6.1 Write failing tests in `packages/dsh-collab/test/self-runtime.test.ts`: 「无远端 runtime 时行为不变」；「self 认领仍拒绝子会话」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 6.2 Implement「本机 runtime 作为 self 提供」使 6.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 6.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 7. dsh-collab：远端调用身份由来源 Host 担保

- [ ] 7.1 Write failing tests in `packages/dsh-collab/test/remote-identity.test.ts`: 「远端成员以自身身份写入」；「跨来源冒用他人 sessionId 与 body 自报来源」；「来源侧不能冒用同机其它会话」；「断开换代后提交被拒」；「托管调用者不能跨机」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 7.2 Implement「远端调用身份由来源 Host 担保」使 7.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 7.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 8. dsh-collab：入站 call 是封闭操作集合

- [ ] 8.1 Write failing tests in `packages/dsh-collab/test/inbound-call.test.ts`: 「未知操作与多余字段」；「存储错误不泄露」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 8.2 Implement「入站 call 是封闭操作集合」使 8.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 8.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 9. dsh-collab：远端空间引用与读写转发

- [ ] 9.1 Write failing tests in `packages/dsh-collab/test/remote-forward.test.ts`: 「远端 Leader 邀请自身机器与第三台机器的会话」；「远端返回值可再次使用」；「单条记录超限」；「远端大日志分段读取」；「两边同名空间互不混淆」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 9.2 Implement「远端空间引用与读写转发」使 9.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 9.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 10. dsh-collab：跨机邀请按被邀请方的信任加入

- [ ] 10.1 Write failing tests in `packages/dsh-collab/test/remote-invite.test.ts`: 「被邀请方信任时自动加入」；「同意后目标换代不加入」；「目标不可达时重放邀请」；「被邀请方不信任或答复丢失」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 10.2 Implement「跨机邀请按被邀请方的信任加入」使 10.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 10.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 11. dsh-collab：远端空间的发现索引

- [ ] 11.1 Write failing tests in `packages/dsh-collab/test/remote-index.test.ts`: 「重启后仍能发现远端空间」；「已移除的条目被清理」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 11.2 Implement「远端空间的发现索引」使 11.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 11.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 12. dsh-collab：跨机工具错误映射

- [ ] 12.1 Write failing tests in `packages/dsh-collab/test/remote-errors.test.ts`: 「不可达与确定拒绝」；「超限请求在本地拒绝」；「超限 overview 回固定错误」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 12.2 Implement「跨机工具错误映射」使 12.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 12.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 13. dsh-collab：跨机投递失败只显示

- [ ] 13.1 Write failing tests in `packages/dsh-collab/test/remote-delivery.test.ts`: 「失败可读、不重投」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 13.2 Implement「跨机投递失败只显示」使 13.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 13.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 14. dsh-collab：宿主声明可托管成员的接入方 channel

- [ ] 14.1 Write failing tests in `packages/dsh-collab/test/config.test.ts`: 「非法配置拒绝启动」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 14.2 Implement「宿主声明可托管成员的接入方 channel」使 14.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 14.3 确认既有场景测试仍在且未改断言：「未声明的 channel 不能接入」；「接入方离开后不可投递」；「未声明托管 channel 时工具面与行为不变」
- [ ] 14.4 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 15. dsh-collab：状态入口的输出白名单

- [ ] 15.1 Write failing tests in `packages/dsh-collab/test/status.test.ts`: 「远端空间与不可达空间」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 15.2 Implement「状态入口的输出白名单」使 15.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 15.3 确认既有场景测试仍在且未改断言：「被唤醒后一次调用即知下一步」；「成员文本不进入输出」；「request 待办带条目 seq」；「用途只作为数据输出」
- [ ] 15.4 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 16. dsh-collab：状态入口隐藏不合规标识

- [ ] 16.1 Write failing tests in `packages/dsh-collab/test/status.test.ts`: 「远端 runtime 段不合规」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 16.2 Implement「状态入口隐藏不合规标识」使 16.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 16.3 确认既有场景测试仍在且未改断言：「旧台账的不合规 itemId 被隐藏」；「不合规的 spaceId 不出现」；「合规标识原样输出」
- [ ] 16.4 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 17. shim：按 relay-contract 接入、对账注册与降级

- [ ] 17.1 Write failing tests in `packages/collab-cockpit-shim/test/reconcile.test.ts`: 「握手后对账注册」；「服务缺失、未连接或处理器被占」；「截断快照中消失不注销」；「shim 卸载与版本变化」；「离线、恢复、删除与 cockpit 重启」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 17.2 Implement「按 relay-contract 接入、对账注册与降级」使 17.1 通过（规范见 specs/collab-cockpit-shim/spec.md，做法见 design.md）
- [ ] 17.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 18. shim：信封编码与带类型的标识改写

- [ ] 18.1 Write failing tests in `packages/collab-cockpit-shim/test/envelope.test.ts`: 「只改写具名字段」；「入站伪造 local」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 18.2 Implement「信封编码与带类型的标识改写」使 18.1 通过（规范见 specs/collab-cockpit-shim/spec.md，做法见 design.md）
- [ ] 18.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 19. shim：reply 关联、超时与体积

- [ ] 19.1 Write failing tests in `packages/collab-cockpit-shim/test/reply.test.ts`: 「正确来源的 reply 被接受」；「伪造来源、迟到与中继回执」；「wake 无回执时超时失败」；「超限请求不发送」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 19.2 Implement「reply 关联、超时与体积」使 19.1 通过（规范见 specs/collab-cockpit-shim/spec.md，做法见 design.md）
- [ ] 19.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 20. shim：入站执行与来源校验

- [ ] 20.1 Write failing tests in `packages/collab-cockpit-shim/test/inbound.test.ts`: 「每次入站都重新判定授权」；「伪造来源」；「窗口外重复写命令幂等」（确认因功能缺失而失败，而不是夹具错误）
- [ ] 20.2 Implement「入站执行与来源校验」使 20.1 通过（规范见 specs/collab-cockpit-shim/spec.md，做法见 design.md）
- [ ] 20.3 Refactor；collab-kernel、dsh-collab、collab-cockpit-shim 全部测试与 typecheck 保持绿，并在 test-plan.md 把对应行翻为 🟢

## 21. 集成与收尾

- [ ] 21.1 在 `dsh.yaml` 增加 collab-cockpit-shim 条目，`enabled: false`；运行 `node scripts/sync.mjs` 两次，第二次无变更
- [ ] 21.2 运行 `npm test`、`npm run check:artifacts`、各包 build/typecheck/test，记录实际结果
- [ ] 21.3 `openspec validate collab-cross-machine-spi --strict` 通过；确认 test-plan 全部 🟢
- [ ] 21.4 与 dsh-cockpit 的 `dsh-cockpit-relay` 插件真实联调另行安排，结果记入 verify.md；联调通过前不启用 shim
