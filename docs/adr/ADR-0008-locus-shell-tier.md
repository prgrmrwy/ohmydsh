# ADR-0008: Locus shell 工具档（显式所有者授权）

- **Status**: Accepted
- **Date**: 2026-09-25
- **Relates to**: OpenSpec change `pet-locus-shell-tier`；`openspec/specs/pet-locus-collaboration/spec.md` 中「Locus 业务出站只能经受管 finish」与新增的工具档位要求；ADR-0005（文件写权限是独立档位）

## Context

Locus safe composition 原本只开放 `read/read_image/glob/grep/web_search` 与 caller-bound Pet 工具。这样的能力边界可强制保证业务回复只经受管 finish，但 child 连当前群的历史消息也无法读取，限制了实际工作能力。

`bash` 是高风险能力：它能使用当前机器上可访问的凭据与网络。当前 DSH 文件沙箱的 read-only 模式限制的是文件写入，不限制文件读取或网络出口；它不能隔离 Lark 凭据。群消息即使只允许 allowlist 的成员驱动，也仍是模型接收的不可信输入。所有者已明确选择：在 `safe` 之外增加一个显式授予的 `shell` 工具档；开放期间只接受 allowlist 驱动；不重建子会话切档；仅开放 `bash` 与 `skill`，不开放后台任务控制或网页抓取；对常见 lark-cli 发送误操作加 guard。

历史上 finish 被拒后模型曾经通过 shell/lark-cli 直接发送消息，造成 Delivery 账目与实际出站不一致。该历史故障解释了受管 finish 的价值，但它不能证明一个字符串 guard 能约束通用 shell。

## Decision

1. 每个 locus 新增与既有文件权限 `read/write` 正交的工具档位：`safe`（默认）与 `shell`。新建、重建与新代际一律回到 `safe`。
2. `safe` 保持既有的只读工具面和 caller-bound Pet 工具，不提供通用 shell 或 Skill 执行。
3. `shell` 由 allowlist 所有者显式授予，仅对该入口生效；该档仅开放 `bash` 与 `skill`；后台任务控制与网页抓取工具均不开放。档位切换不重建子会话。切换必须在入口空闲时完成并回读实际工具面验证；失败不得回执成功，须恢复 `safe` 并确认恢复结果。
4. 档位为 `shell` 时，入口只接受 allowlist 成员的 at 作为工作请求。持久组合的宽底座可包含 shell 档工具，但任何档位都结构性排除 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 与 agent 控制工具。子委派不得依赖可撤销的档位限制层来排除。
5. `pet_locus_finish` 保持唯一受管出口。`shell` 档不是安全隔离模式：Host 对 bash 中常见的 lark-cli 消息写命令注册工具 guard，只是降低误操作概率。guard 不解析任意 shell，不隔离 HTTP、脚本或复制后的可执行文件，不能阻止有意绕过；管理面、prompt、文档与回执都不得称其为安全边界。
6. `shell` 档允许模型以本机 bot 身份读取当前入口的群消息。禁止跨群、私聊或全局读取是 prompt 行为约束，不是执行权限边界。允许名单外成员的群内容仍可能作为上下文进入模型。
7. 管理面与授权回执必须明确告知：shell 可用本机文件读取与网络；文件写入仍取决于独立 `read/write` 沙箱档；bot 凭据对 allowlist 驱动的模型可用；常见发送命令 guard 不是安全边界。此决策不修改全局 write 开关或现有 `read/write` 语义。

## Consequences

### 正面

- 所有者可显式在 `safe` 与 `shell` 间切换，而不丢失同一个 child 的会话历史。
- allowlist 所有者可让 child 读取当前群历史并使用 shell/skill 能力。
- 委派面在组合底座中结构性排除，即使档位收紧层故障也不会获得孙代理能力。
- 常见的 finish 失败后 lark-cli 直发误操作会被拒绝，并给出正确的受管 finish 回退提示。

### 负面（由所有者显式接受）

- `shell` 档把本机 shell 与可访问的飞书身份交给该入口 allowlist 驱动的模型；本机的读权限和网络均不由 read-only 文件沙箱隔离。
- 群消息仍是不可信输入。即使只有 allowlist 能触发工作，模型也可能被群上下文中的提示注入诱导去读取其它本机资料或使用网络。
- guard 是有限的命令误操作拦截，不是 egress 控制。脚本、HTTP 或未识别命令仍可能绕过它，业务出站也可能因此逃逸 finish/Delivery 账本。
- `safe-v1` 组合不具备可动态撤销的档位层，继续按 safe 服务；欲启用 shell 必须显式重建一次以获得 `safe-v2`。切换新档位后无需再重建。
- read-only 沙箱下 lark-cli 是否能在不修改 token/cache 文件时读取群历史，须在等价真实运行环境验证；在验证前不得假定功能可用或以扩大文件权限补救。

## Rollback

回滚到仅 safe 的实现时，必须同时停止创建 `safe-v2` 宽底座子会话，并将已存在 `safe-v2` locus 以可证明的方式置为 invalid/要求显式重建，或由兼容版本保留对 `safe-v2` 的安全恢复处理。只回退代码却保留 `safe-v2` 持久行会使旧版无法证明子会话工具组成；不得静默恢复成继承父 preset 的 child。回滚不得删除既有会话历史或伪造安全验证。
