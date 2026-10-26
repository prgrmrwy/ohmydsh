# ohmydsh worktree preview 验收记录

日期：2026-10-26；平台 macOS；DSH 0.2.0-rc.2；使用本 change 当前 worktree 实现。未合入、未生产部署、未重启 3080。

## 真实自举结果

1. `node bin/dsh.mjs build` 初次在入口拒绝：lean 缓存缺 typescript。通过 Host 的 `ws promote` 切换到独立 mutable 依赖后，launcher 健康检查通过，不修改共享缓存、不改变 lockfile。
2. 初次隔离 sync 在用户级 Anvil schema 非托管保护处失败，暴露 XDG_DATA_HOME 不随 DSH_HOME 隔离的问题。launcher 已补隔离模式的 XDG_DATA_HOME。随后隔离构建成功；正式 launcher 重复 `build` 也成功。
3. 当前日常 Host schema 尚无新 action，使用 worktree 构建的 `dsh-ws prepare-preview <worktree>`。首次 9 次写入、缺失项 none，首选端口 3275。重复准备为 0 次写入。
4. `node bin/dsh.mjs --no-open` 成功启动隔离 Host，输出 `DSH_PREVIEW` 的端口为 3275，运行根为该 operation 的隔离 home。全程没有打开或关闭桌面窗口。
5. 使用隔离 Host 官方 `/api`，启动 token 在进程内交换 cookie，不打印 token/cookie。创建普通验收 Session，发送不调用工具的提示。收到 `assistant/message`：provider=codex、model=gpt-6.1-sol、text=`PREVIEW_MODEL_OK`，finish=stop。不是 prompt accepted，也不是提示词回显。
6. 使用真实订阅插件 `listAccounts(provider, isolatedAuthPath)` 只读加载器核对：codex 有效账号 1、claude 有效账号 1。codex 已由实际模型回答证明；claude 本轮未额外发模型请求，不能宣称两个 provider 都完成了推理。
7. 对真实 home 白名单文件保存 SHA-256，模型回合后逐个相等；3080 监听者 pid 与创建身份前后一致。未复制真实 Session/storage/state。
8. `node bin/dsh.mjs restart --port 3080` 以非零状态拒绝，未操作日常 Host。
9. 身份核验后停止自己的 3275 预览；在首选 3275 放置当前验收脚本拥有的普通监听，再执行正式 launcher。预览自动退避到 3276，占位监听持续存活；preview.json 的 pid 等于 3276 监听者 pid。
10. 用身份停止器停止自己的 3276；确认端口空、占位监听仍存活、3080 身份不变，最后关闭本验收占位监听。未留下运行中的预览 Host。

## 自动化覆盖

- 白名单复制、auth 字节一致、browser-session 本地值保留、无 profile 零写入、拒绝错误 home、幂等、registry-only、Session 不复制、真实源文件不变。
- 3080 在 probe/stop/build 前拒绝；无关占用偏移；同首选的两个并发 launcher 各自记录自己的监听者；bind 输家不认赢家；显式端口不退避；20 次上限与回绕；过期身份不发信号。
- 既有普通 launcher contract、lifecycle 回归通过；初次全量发现的新增 Git 调用已修复，普通 history 不产生额外命令。

## 限制与风险

- Windows 按用户要求不作为本轮门槛。
- 订阅 refresh token 是独立快照；codex 若在预览中刷新，日常 GUI 可能需要重新登录。memex 仍使用真实库；验收模型提示禁止工具，因此未触发写卡。
- 预览是独立 home，不是安全沙箱。显式修改 DSH_HOME 指向生产仍是部署动作，不因该护栏获得授权。
- 原始 page/request-header 与哈希清单只用于本轮，已删除；保留此轻量报告与自动化测试，不提交 raw session evidence。
- 当前日常 GUI 仍加载旧工具；新版工具在隔离 Host 的 request/header 中已可见，但日常 GUI 注册冒烟需以后获准部署后完成。
