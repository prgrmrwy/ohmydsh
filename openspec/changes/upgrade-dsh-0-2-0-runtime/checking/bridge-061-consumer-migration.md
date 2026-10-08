# bridge 0.6.1 消费方迁移（2026-10-08）

## 范围与依据

基线 main `a844cdccc9599b1ab727b4ed05ec5010a1ec7575` 已 pin bridge 0.6.1。旧 shim0.1.1 仍读取已删除的 `cockpitBridge.portForward`；真实 memex registry 在没有 resolver 时默认交付 localhost，类型/构建成功并不证明远端可达。

官方 bridge 发布源 `6c7ffbaaab0b05f2f2483d498a68a04abf7ea3a7` 的新 forwards 类型与实现，以及 active change `device-forward-registry` 的接缝 delta 是新 API 依据。Cockpit current spec 仍含旧 portForward，已明确记录差异，未修改其源码/规范。ohmydsh 本 change 新增 shim delta：必要句柄生命周期替代旧无状态约束；失败关闭优先于卸载后默认 localhost。独立 memex-only 部署仍可默认本机浏览。

## RED → GREEN

- 新测试直接使用 `createBrowseAddressRegistry()`，fixture 只提供 forwards；旧代码失败：预期 `http://127.0.0.1:54321`，实际 `http://localhost:3940`。
- shim0.2.0 使用 acquire/onChange/state/address/release；按端口单飞，每个绑定唯一 holder，不缓存 URL、不自行重试；只有结构化 local-device 降级。
- 20 package tests PASS，host/client typecheck PASS，build PASS。
- 根测试 321 total / 319 pass / 0 fail / 2 skipped；artifact policy PASS；`git diff --check` PASS；OpenSpec change strict PASS。
- strict 首次拒绝遗漏的旧 scenario 名，已补回并明确新语义；未绕过校验。

## 完整范围自审

Native 执行者自审基线到当前变更全部源文件、manifest/lock 版本元数据、README、design/tasks 与新增 delta/test；没有子代理，没有第三方源码修改。

1. 从完整 dotted name 读取；无顶层 inject；任意加载顺序与只安装单端不阻碍加载。
2. starting/retrying/paused 只在 ready 后交付，15s 等待超时；监听器/计时器在完成/失败/解绑时清理。
3. 同端口并发单飞，打开后不立即释放；再次打开读取变化后的当前地址。
4. removed 等待失败不自动 acquire；空闲 ready 句柄在两次点击间 removed 时，第一次显式重开即可重新 acquire。
5. bridge 消失保留 fail-closed resolver，取消旧调用；registry 替换/dispose 注销旧 resolver。
6. 已获取和迟到句柄只通过原生产服务释放；holder 带绑定 随机标识，旧释放不触及新绑定。release rejection 已处理。
7. local-device 按 name/code 结构判断；unavailable/未握手、请求与业务失败不误作本机。没有跨 bundle instanceof。
8. lock 修改仅修正本地 workspace 的版本元数据，没有依赖安装或版本更新。

补充检查：随机标识使用 plain-HTTP 页面可用的 `crypto.getRandomValues`，不依赖 secure-context-only `randomUUID`；removed 句柄删除时同时清理 acquired 引用，且只清理当前所有权，防止并发旧等待清掉新绑定。最终 root 复跑及 strict/artifact 均通过，补充引用清理后 focused tests/typecheck 复核。

Jev 对摘要与测试说明的审查返回 escalate（correctness confidence0.26 / safe_to_apply0.22），没有可定位的缺陷说明；不把它当自动放行。Native 对完整实现/真实 registry/官方 seam 源码再次逐项核查上述生命周期与并发所有权，人工自审无剩余 Critical/Important 代码发现。该审查不证明正式部署或真实浏览器功能通过。

## 清理与发布边界

用户先授权清理 local repair；157 文件约1.1 MB 已删除，在用 launcher 保留。随后用户要求检查 staging 并认为可直接删除；确认指定 staging 只有生成依赖/兼容包、无跟踪文件，原 PID 不存在、无打开文件/进程/外部符号链接引用后，删除该唯一残留（26636 文件/445280469 字节）。其他 staging/worktree 未清理。

此 change 没有 `.spec-superflow.yaml`，spec-merger state guard 拒绝发布；没有初始化额外 SSF 状态、没有伪造 receipt、没有归档。新契约 delta 保留为当前活动执行依据，整体 current-spec 同步留待实际验收后 OpenSpec 收口。

## 尚待正式验证

受控合入/push、devbox 从主干拉取后的 build×2/restart、真实功能/浏览器验收与独立新 home 尚待执行。历史 checking 证据不冒充本次正式组合。Mac 不重启；WSL/VM 延后。
