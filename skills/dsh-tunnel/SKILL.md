---
name: dsh-tunnel
description: 从另一台机器经 SSH 隧道访问本机 DSH Web GUI(公钥免登、端口占用自动退避、浏览器打开完整 GUI)。也用于诊断隧道不通、端口冲突,以及说明为何不采用明文局域网直连。
whenToUse: 用户想从别的电脑/远程访问 DSH Web、问「远程访问」「局域网访问」「另一台机器打开 DSH」「SSH 隧道」,或隧道已配但打不开、端口被占、连上却看到别的服务时。
---

# 跨机器访问 DSH:SSH 隧道

## 这个 skill owns 什么

- 从**客户端机器**(想访问 DSH 的那台)建立到**服务端机器**(跑 DSH 的那台)的 SSH 本地端口转发,并在浏览器打开完整 Web GUI;
- 隧道相关排障:端口占用、转发未建立、公钥未授权、远端 DSH 未运行;
- 解释为何不使用明文局域网直连(`web.lan` / `DSH_LAN` / 门禁插件)。

不 owns:DSH 自身的启动与插件装配(见 `add-dsh-plugin` / `remove-dsh-plugin`)、让 agent 去远程机器执行命令(那是别的能力)。

## 为什么是隧道,不是绑 0.0.0.0

DSH Web 客户端在 RPC id 路径使用 `crypto.randomUUID()`,该 API **仅在安全上下文可用**。明文 HTTP + 非 localhost 时它是 `undefined`,GUI 整体不可用。于是直连必须同时解决 secure context、传输加密、身份认证三件事。

隧道一次全解决,且暴露面最小:

| 诉求 | 隧道如何满足 |
| --- | --- |
| 身份认证 | SSH 公钥免登(`authorized_keys`),强于密码 |
| 传输加密 | SSH 自带,强于自签 TLS 且无浏览器证书告警 |
| secure context | 浏览器访问 `http://127.0.0.1:<port>`,回环即安全上下文,无需 HTTPS/证书/polyfill |
| 暴露面 | DSH 保持 `127.0.0.1` 绑定,局域网**零端口**暴露 agent |

⚠ 明文局域网直连(绑 `0.0.0.0` + 密码门禁)已评估并**弃用**:同网可嗅探密码与 cookie。不要主动建议用户开 `web.lan` 或 `DSH_LAN`。取舍全过程见仓库 `docs/notes/lan-access-ssh-tunnel.md`。

## 流程

### 1. 确认服务端可 SSH 登录

在**服务端**上确认远程登录已开(macOS:系统设置 → 通用 → 共享 → 远程登录;或 `sudo systemsetup -setremotelogin on`)。

探测端口时注意:`lsof` 在无权限时可能看不到 sshd 而**误判为未开启**,用 `nc -z 127.0.0.1 22` 复核。

### 2. 客户端装公钥(一次性)

```bash
ssh-keygen -t ed25519 -C "$(hostname)-to-dsh"   # 已有密钥则跳过
ssh-copy-id <user>@<server-ip>                   # 最后一次输密码
```

Windows 客户端无 `ssh-copy-id` 时:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh <user>@<server-ip> "cat >> ~/.ssh/authorized_keys"
```

### 3. 装成跨 shell 的全局命令(推荐先做,一次性)

用户的真实目标通常是「以后一个词就能连上」。**alias / fish function 绑死单一 shell**(用户在 fish 与 bash 间切换时会「命令不存在」);装成 PATH 里的可执行文件才跨 shell 通用。在客户端执行:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.dsh/skills/dsh-tunnel/scripts/dsh-tunnel.sh ~/.local/bin/dshvm   # 或指向仓库内路径
export DSH_TUNNEL_HOST=<host-or-ssh-alias>    # 写进用户实际 shell 的 rc
```

之后任意 shell 下敲 `dshvm` 即可。若 command not found,把 `~/.local/bin` 加进 PATH(bash→`~/.bash_profile`,zsh→`~/.zshrc`,fish→`fish_add_path ~/.local/bin`)。

⚠ 命令名别和 DSH 自带的 `dsh` 冲突,用 `dshvm` / `dshweb` 之类。

### 4. 起隧道

```bash
dsh-tunnel.sh                    # 预检远端 → 占用自动退避 → curl 校验 → 开浏览器
dsh-tunnel.sh status             # 查看隧道与实际本地端口
dsh-tunnel.sh stop               # 关闭本脚本起的隧道
dsh-tunnel.sh -p 9000            # 指定起始本地端口(仍会退避)
dsh-tunnel.sh --strict           # 端口被占直接失败,不退避
dsh-tunnel.sh --no-open          # 不自动开浏览器
dsh-tunnel.sh --no-remote-start  # 不检查/启动远端 DSH,只建隧道
```

远端信息经环境变量配置(写进 shell rc 免传参),也可用 `--host` / `--user` / `--remote-port` 覆盖:

```bash
export DSH_TUNNEL_HOST=<host>     # IP、主机名,或 ~/.ssh/config 别名(如 lumevm);必填
export DSH_TUNNEL_USER=<user>     # 留空则不拼 user@,交给 ssh 按别名解析
export DSH_TUNNEL_PORT=3080       # 远端 DSH 端口
```

⚠ **用 ssh 别名时不要再加 `--user`** —— 会覆盖别名里的 `User` 导致连错账号。

脚本行为:

- **远端预检**:先 ssh 探测远端 DSH 是否在跑,**没跑就用 `dsh --no-open -p <port>` 远程拉起**并等待就绪(最多 30s);远端没装 `dsh` 命令时明确报错。用户因此不必先手动登录远端开服务;
- **只退避本地端口**(远端端口恒定,两侧独立);
- 已有同远端隧道则复用,不重复起;
- 建成后 `curl` 实测 HTTP 200 才报就绪;
- 始终带 `ExitOnForwardFailure=yes`;
- `status` / `stop` 按完整转发规格匹配进程,不误伤其它 ssh。

### 4. 不用脚本时的等价手写配置

客户端 `~/.ssh/config`:

```sshconfig
Host dsh
  HostName <server-ip>
  User <user>
  LocalForward 3080 127.0.0.1:3080
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure yes
```

然后 `ssh -N dsh`,浏览器开 `http://127.0.0.1:3080`。

**`ExitOnForwardFailure yes` 不可省**:OpenSSH 默认在本地端口被占时只打印告警却仍建立 SSH 连接,导致「连上但没有转发」——浏览器打开看到的是本地占用该端口的其它程序,极难察觉。

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| `Permission denied (publickey)` | 公钥没装成功,重跑第 2 步 |
| `bind: Address already in use` | 本地端口被占。用脚本会自动退避;手写配置则改 `LocalForward` 左侧端口 |
| 打开页面是别的服务 | 转发未建立而 SSH 连上了 —— 缺 `ExitOnForwardFailure` |
| 页面能开但功能异常/空白 | 远端 DSH 没在跑,或不在 `DSH_TUNNEL_PORT` 指定端口 |
| 浏览器转圈、突然断 | 隧道断开(合盖/换网)。重起隧道;`ServerAliveInterval` 让死连接更早暴露 |
| 地址记不清 | 退避后端口可能不是 3080。`scripts/dsh-tunnel.sh status` 查看,脚本也会打印并自动开浏览器 |

## 端口冲突:两侧都不自动退避

- **服务端 DSH**:端口被占则**启动失败**,不静默换端口(上游 `dsh-host-webserver`:listen 失败即 reject Loader 组合;`bin/dsh` 的 `do_restart` 会报 `port ... still busy`)。这是刻意设计——自动改端口会让客户端隧道配置指向错误目标而无提示。需要改端口时显式 `dsh -p <port>`。
- **客户端**:OpenSSH 默认不退避且行为危险(见上)。本 skill 的脚本负责退避与校验。

## 关键提醒

访问地址永远是 **`http://127.0.0.1:<本地端口>`**,不是服务端的局域网 IP。服务端 IP 在隧道方案下**连不上是正确的**,那正是零暴露的体现。
