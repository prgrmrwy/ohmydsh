# 跨机器访问 DSH:SSH 隧道方案

B015 的落地形态。目标:从局域网另一台电脑使用本机 DSH Web GUI,要求免密登录、传输加密、GUI 功能完整。

## 为什么是隧道,而不是「绑 0.0.0.0 + 门禁」

DSH 的 Web 客户端在 RPC id 生成路径使用 `crypto.randomUUID()`(`dsh-client-connection` 两处、`dsh-client-ui-conversation` 一处)。该 API [仅在安全上下文可用](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID),明文 HTTP 且非 localhost 时为 `undefined`,GUI 整体不可用(上游讨论 [#4209](https://github.com/deepseek-ai/deepseek-harness/discussions/4209)、[#2396](https://github.com/deepseek-ai/deepseek-harness/discussions/2396))。

于是「局域网直连」必须解决三件事:secure context、传输加密、身份认证。隧道一次全解决:

| 诉求 | 隧道如何满足 |
| --- | --- |
| secure context | 浏览器访问的是 `http://127.0.0.1:<port>`,回环属安全上下文,`randomUUID` 原生可用 —— 无需 HTTPS、证书或 polyfill |
| 传输加密 | 由 SSH 负责,强度高于自签 TLS,且无浏览器证书告警 |
| 免密认证 | SSH 公钥,即 `authorized_keys` 机制 |
| 暴露面 | DSH 保持 `127.0.0.1` 绑定,局域网**零端口**暴露 agent |

对比被否决的方案:

- `dsh-lan-gate`(密码 + CIDR):明文 HTTP,同网可嗅探密码与 cookie;需要每设备输密码。manifest 条目保留但 `enabled: false`,可回退。
- `@wingsky-1/dsh-lan-proxy`(TLS 代理):与门禁**不可叠加** —— 代理终结连接后转发到回环,使 gate 看到的对端 IP 恒为 `127.0.0.1`,命中 `loopbackBypassAuth` 导致门禁完全失效;反向若补 `X-Forwarded-*` 又被 `rejectProxyHeaders` 全拒。

## 服务端(本机)配置

保持默认即可,无需改动:

- `dsh.yaml` `web.lan: false`(默认),webserver 绑 `127.0.0.1:3080`;
- manifest 条目 `lan-gate` 为 `enabled: false`,不参与 bundle;
- 需开启系统「远程登录」:系统设置 → 通用 → 共享 → 远程登录(或 `sudo systemsetup -setremotelogin on`)。

`sshd_config` 的 `PubkeyAuthentication` 与 `AllowTcpForwarding` 默认均为 `yes`,隧道无需额外配置。

## 客户端(另一台电脑)配置

一次性:把该机器的公钥追加到本机 `~/.ssh/authorized_keys`。

```bash
# 在客户端机器上(没有密钥时先生成)
ssh-keygen -t ed25519 -C "$(hostname)-to-dsh"
ssh-copy-id prgrmrwy@192.168.64.3
```

然后在客户端 `~/.ssh/config` 写一条,把转发固化:

```sshconfig
Host dsh
  HostName 192.168.64.3
  User prgrmrwy
  LocalForward 3080 127.0.0.1:3080
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure yes
```

日常使用:

```bash
ssh -N dsh            # 前台保持;加 -f 可后台化
# 浏览器打开 http://127.0.0.1:3080
```

`ServerAliveInterval` 让休眠/断网后的死连接及时暴露;`ExitOnForwardFailure` 确保端口占用时立刻失败而不是静默连上却没有转发。

## 验证记录(2026-08-24)

在本机以临时密钥自连(`-L 39080:127.0.0.1:3080`)完成端到端验证,测试后已撤销临时密钥并恢复 `authorized_keys`:

| 检查项 | 结果 |
| --- | --- |
| 隧道建立 | 成功(公钥认证) |
| GUI 首页 | HTTP 200,16631 bytes,含 `__DSH_BOOT__` 与 `<title>DeepSeek Harness</title>` |
| `/api/respond` | HTTP 200,响应与直连 3080 **完全一致**(浏览器信任围栏放行) |
| `/api/events.mux` WebSocket 升级 | **HTTP 101 Switching Protocols** |
| 直连 `192.168.64.3:3080` | 连接失败(预期:回环绑定,局域网无暴露) |

`/api` 能通过是因为官方围栏对回环 Host 天然放行,隧道后浏览器发出的 Host 就是 `127.0.0.1:3080`。

## 已知限制

- **每次使用需先起隧道**;可用 `-f` 后台化或交给 autossh / launchd 常驻。
- **手机/平板不便**:移动浏览器难以走隧道。若将来需要移动端访问,再评估 HTTPS + 长效 cookie 或 mTLS 路线(见 B015)。
- 客户端本地 3080 若被占用,`ExitOnForwardFailure` 会让连接直接失败 —— 换个本地端口即可(如 `LocalForward 3081 127.0.0.1:3080`)。
