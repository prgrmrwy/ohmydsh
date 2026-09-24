# 7.3 subscriptions 0.9.2 / 7.7 Trae 0.1.15 实机验收(devbox)

前提:devbox 上由用户登录了 subscriptions 的 **codex**,Trae 复用既有 CLI 登录态。
claude / grok / copilot **未登录**,故其断言按"未验证(未登录)"记录,不写成通过。

## 7.7 Trae 0.1.15 —— 端到端通过 ✅

登录态(经 `~/.trae/cli/auth.json`,bridge 兼容读取;不需要 `~/.dsh/traex-bridge/`):

```
login_method: git_codebase   region: CN
expires_at: 2026-09-25T11:23:29Z   → 未过期
```

真实调用(浏览器驱动,默认模型即 `traex/GPT-5.6-Sol`):

| 轮次 | 提示 | 结果 |
|---|---|---|
| 1 | `请只回复两个字：收到` | `已思考` → **`收到`**;26.6K tok;5 秒 → **stream 通过** |
| 2 | `用 bash 工具执行 pwd，然后把输出原样贴出来` | **`1 次工具调用`** → 返回真实 cwd `/data00/home/zhangyong.617/corp/nexus` → **tools 通过** |

附带通过:prompt 缓存命中(第 2 轮 33%;`缓存 26.1K`)、cost-meter 计价
(`本会话 ¥0.0824 · 输入 54K · 缓存 26.1K · 输出 100`)、会话计数与步数正常。

## 7.3 subscriptions 0.9.2 —— 大部分通过,一处未验

### 通过项

**① 升级动机已实机证实。** `models.json` 的 codex 目录返回 5 个模型,**含 `gpt-6-astra`**:

```
gpt-5.6-sol   gpt-6-astra   gpt-5.6-terra   gpt-5.6-luna   gpt-5.5
```

0.9.2 升级的唯一理由就是修 Astra 缺失(旧 pin 把 `client_version` 硬编码 `0.147.0`,
ChatGPT 后端按该参数分流,`0.153.4` 起才返回)。**现在 Astra 在列 = 该修复生效。**

**② provider 集合 = 5**(`/api/subscriptions-auth.status` 实测):
`codex / claude / grok / copilot / antigravity`,与任务清单一致。

**③ 凭据不回显。** 同一响应里 `accessToken|refreshToken|idToken|apiKey|"token"`
命中数 **0**;只返回不透明账号 key + 邮箱 + 套餐:

```json
{"codex":{"accounts":[{"key":"<uuid>","isDefault":true,"account":"<email>","plan":"prolite"}]},
 "claude":{"accounts":[]},"grok":{"accounts":[]},"copilot":{"accounts":[]},"antigravity":{…}}
```

**④ auth 路由可达 + 唯一性。** 实测可达:`status` / `login` / `logout` / `speed` /
`cancel` → 200(业务信封);不存在的 endpoint → **404**(可靠负例)。
唯一性有**硬保证**:connection 层对 `/api` 只允许一个 interceptor
(`already has an interceptor` 会直接抛错),插件正常加载即证明唯一。

**⑤ Host fence 与认证。** 伪造 `Host` + 有效会话 → **403**;无会话 → **401**。

### 未验证(明确记录,不写成通过)

- **codex 的生成调用(stream/tools/image)** —— 未做。模型切换在 GUI 里位于
  "模型 ›" **二级菜单**,用 CDP 试了点击内层 SPAN / ArrowRight 进入 /
  `mouseMoved` 悬停三种方式都未能展开,故无法把会话切到 codex 模型。
  已通过的目录请求需要**有效凭据 + 对 ChatGPT 后端一次成功握手**,所以认证面是通的;
  但生成面**未验**。
- **claude / grok / copilot** —— 未登录,相关断言(image_generate / video_generate /
  x_search / thinking-effort / Copilot 目录)全部未验。
- **18 条 auth route 的逐条点名** —— 只确认了可达的那几条与"404 可作负例";
  未能从压缩发布物里抽出完整 endpoint 清单。

## ⚠ 附带发现:构建期代理被长驻 Host 继承,会打断内网 provider(属 8.4)

第一次真实调用**全部失败**:

```
已重试模型请求（5/5）· 9s
本轮运行失败  Trae request failed before receiving a response
TRANSPORT
```

**原因是我自己造成的**:我在若干 `dsh restart` 脚本里 `export http_proxy/https_proxy`
(为了 `npm ci` / `dsh build` 拉包),Host 进程**继承**了它们:

```
Host 进程 environ: http_proxy / https_proxy 均已设置
登录 shell:        http_proxy=<unset>          ← 用户正常启动不会有
```

Trae 是内网服务,请求被套进内网代理后直接 TRANSPORT 失败。

**处置**:`unset http_proxy https_proxy no_proxy` 后再 `dsh restart`;重启后进程内
代理变量数为 **0**,Trae 立即恢复正常(见上表)。

**这是一条真实的运维约束,不只影响本次测试**:

- 代理**只用于构建期**(`npm ci`、`dsh build` 拉 registry);
- **不得**被长驻 Host 继承,否则内网 provider(Trae 等)与其内部域名会被绕进代理;
- 若确需 Host 出网走代理,应通过 DSH 自己的出站代理配置,而不是进程环境变量。

因此 host/lumevm 的 apply 序列里,**`dsh restart` 那一步必须在无代理的环境里执行**
(或 `env -u http_proxy -u https_proxy dsh restart`)。
