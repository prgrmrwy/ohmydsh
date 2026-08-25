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
ssh-copy-id <user>@<server-ip>
```

然后在客户端 `~/.ssh/config` 写一条,把转发固化:

```sshconfig
Host dsh
  HostName <server-ip>
  User <user>
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

## 推荐:用 `dsh-tunnel` skill 一条命令搞定

这套能力已抽成 skill(`skills/dsh-tunnel/`),会随 sync 部署到 `~/.dsh/skills/dsh-tunnel/`,可被自然语言触发(「怎么从另一台电脑访问 DSH」)。脚本随 skill 一起分发,两处路径均可执行:

- 仓库内:`skills/dsh-tunnel/scripts/dsh-tunnel.sh`
- 部署后:`~/.dsh/skills/dsh-tunnel/scripts/dsh-tunnel.sh`(客户端机器上装了 ohmydsh 即可用)

手写 `ssh -L` 的痛点是端口撞了要自己改配置。脚本把「探测占用 → 退避换端口 → 建隧道 → 校验可达 → 开浏览器」串成一步(运行在**客户端**):

```bash
skills/dsh-tunnel/scripts/dsh-tunnel.sh                 # 起隧道:占用则自动 +1 退避,通了自动开浏览器
skills/dsh-tunnel/scripts/dsh-tunnel.sh status          # 查看当前隧道与实际本地端口
skills/dsh-tunnel/scripts/dsh-tunnel.sh stop            # 关闭本脚本起的隧道
skills/dsh-tunnel/scripts/dsh-tunnel.sh -p 9000         # 指定起始本地端口(仍会退避)
skills/dsh-tunnel/scripts/dsh-tunnel.sh --strict        # 端口被占直接失败,不退避
skills/dsh-tunnel/scripts/dsh-tunnel.sh --no-open       # 不自动开浏览器
```

远端信息经环境变量配置,写进 shell rc 后免传参:

```bash
export DSH_TUNNEL_HOST=<server-ip>    # 跑 DSH 的机器(必填,无默认)
export DSH_TUNNEL_USER=<user>         # 默认取本机当前用户名
export DSH_TUNNEL_PORT=3080           # 远端 DSH 端口
```

行为要点:

- **只退避本地端口**,远端端口恒为 `DSH_TUNNEL_PORT` —— 两侧端口互相独立;
- 起隧道前先查是否已有指向同一远端的隧道,**有则复用不重起**(幂等);
- 建成后用 `curl` 实测 HTTP 200 才报「就绪」,否则提示远端 DSH 可能没在跑;
- 始终带 `ExitOnForwardFailure=yes`,杜绝「连上但没转发」;
- `status` / `stop` 按完整转发规格匹配进程,不误伤其它 ssh 连接。

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

脚本化验证(2026-08-24):`skills/dsh-tunnel/scripts/dsh-tunnel.sh` 全路径实测通过——3080 被占时自动退避到 3081 并 curl 得 HTTP 200;`status` 正确报告 pid 与实际端口;重复 `start` 复用既有隧道;`--strict` 拒绝退避并以退出码 1 失败;`-p 9500` 指定端口可用;`stop` 干净关闭。测试用临时密钥已撤销。

补充验证(2026-08-24,确认「隧道能否用 Web 窗口」):经隧道取到的是**完整浏览器 GUI**,非终端形态——首页 `content-type: text/html`(17458 bytes,`<title>DeepSeek Harness</title>`),主 JS bundle `/assets/index-*.js` HTTP 200(399 KB),插件前端资源 `/plugins/dsh-cost-meter/client.js` HTTP 200,WebSocket 101。即实时流式输出与侧边栏等定制均正常。

## 端口冲突:两侧都不自动退避

**服务端(本机 DSH)**——端口被占则**启动失败**,不会静默换端口。上游 `dsh-host-webserver` README:「A listen failure (EADDRINUSE…) throws out of activation and rejects Loader composition」;`bin/dsh` 的 `do_restart` 亦会在端口未释放时报 `error: port 3080 still busy after stopping DSH`。这是刻意设计:若自动改用 3081,客户端隧道配置会指向错误端口而毫无提示。需要换端口时显式指定 `dsh -p 8080`。

**客户端(另一台电脑)**——OpenSSH 默认行为**危险**:本地端口被占时只打印 `bind [127.0.0.1]:3080: Address already in use` 警告,**SSH 仍会连上但转发未建立**,浏览器打开 `127.0.0.1:3080` 看到的是本地占用该端口的其它程序,而非 DSH。上文 `~/.ssh/config` 中的 `ExitOnForwardFailure yes` 正是为此:转发失败即退出并报错,避免「连上了却没用」的假象。

撞端口时改客户端本地端口即可,服务端不动:

```sshconfig
  LocalForward 3081 127.0.0.1:3080    # 左=客户端本地端口(任选),右=Mac 上 DSH 的真实端口
```

浏览器随之改开 `http://127.0.0.1:3081`。左右两个端口互相独立,客户端用什么端口都不影响本机。

## 已知限制

- **每次使用需先起隧道**;可用 `-f` 后台化或交给 autossh / launchd 常驻。
- **手机/平板不便**:移动浏览器难以走隧道。若将来需要移动端访问,再评估 HTTPS + 长效 cookie 或 mTLS 路线(见 B015)。
