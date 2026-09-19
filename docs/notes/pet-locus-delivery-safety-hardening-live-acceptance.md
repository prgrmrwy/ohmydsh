# Pet Locus Delivery Safety Hardening · 真实群验收清单

> 状态：待执行。2026-09-18 用户选择本轮不重启 Host、不向真实群发送验收消息。
>
> 目标群：`oc_3c57889c7808eae69b5ad1dd9ddc8ace`（「答疑 · 伙伴对话调整2期」）。
>
> 本文只保存步骤与判据。执行后只补低敏结果、时间与状态分类，不提交消息正文、图片、open_id、raw session/history 或数据库副本。

## 只读前置检查（2026-09-18）

- 现有 `dsh web` PID：`56286`；未重启，故当前进程仍可能加载旧 Host 代码。
- `http://127.0.0.1:3080/` 返回 `401`，证明既有 GUI/Host 可达且认证边界仍在。
- `dsh-pet` profile 的 bot 身份为 `ready / available / verified`。
- 目标群可由 bot identity 读取最近消息；未因缺 `search:message` scope 改用全局搜索，改走 caller-bound chat message list。
- 已只读实测包内私有 `lark-cli`：历史 JPEG 仅经 fd3 返回 590,618 bytes；`max-bytes=100` 时读前拒绝且 fd3 为 0 bytes。
- 未发送飞书消息、未重启 Host、未留下图片或 raw history 文件。

## 前置条件

1. 当前 checkout 已完成 `node scripts/sync.mjs`，连续第二次输出 `no changes`。
2. `packages/dsh-pet` 的 build、typecheck、完整 Vitest、artifact check 和 OpenSpec strict validation 全部通过。
3. `lark-cli --profile dsh-pet auth status --json --verify` 显示 bot `ready/available/verified`。
4. 记录当前 `dsh web` PID；执行 `dsh restart` 后等待既有 `http://127.0.0.1:3080` 恢复。不要启动替代 server。
5. 重启会先把缺少 `childComposition: safe-v1` 的历史 active locus 标为 invalid。若目标群命中旧代际，先由所有者通过既有控制面显式 rebuild；不得让普通消息自动恢复 legacy child。

## 验收用例

### A. 合法回复与唯一出口

- 用 **user identity** 在目标群发送一条自包含、只需只读判断的 `@bot` 问题。
- 通过条件：产生新 Delivery；child 可调用 `pet_locus_finish(reply)`；群内恰有一条业务正文；Delivery 为 replied/outbound success；没有直接 `lark-cli`/shell/Skill 发送。
- 反证：普通 assistant 文本或 `turn/end` 不应产生群正文或完成 Delivery。

### B. reference-only 静默结算

- 用 user identity 发送同时 mention 本 bot 与另一参与方的消息，语义明确为“本 bot 只是联系人/关联方提示，无需本 bot 行动”。
- 通过条件：addressing 中 self 与其它参与方结构存在；模型判为 reference-only；调用 `pet_locus_finish(no-reply)` 且 reason 非空；群内没有业务正文；Delivery 为 no-reply；下一条 backlog 可继续。

### C. ambiguous 澄清与新 Delivery

- 发送一条无法确认本 bot 是回答、执行还是关联方的 `@bot` 消息。
- 通过条件：A 只发一次简短澄清，并由 `finish(reply)` 终结。
- 再以 user identity at/reply 回答澄清。
- 通过条件：回答形成新 Delivery B；仍由同一 persistent child 利用历史处理；不重新打开 A；用户不回复时不自动创建 todo。

### D. 多人 backlog 串行

- A current 尚未完成时，快速发送 B、C 两条合格 at。
- 通过条件：B、C 先按接受序进入 backlog；A 终结后依次成为 current；每条保持自己的 message/reply target；没有 next-step/next-turn 业务归属串线。

### E. GUI/user mixed fail closed

- 在一条 current Delivery 运行期间，从 GUI 对该 locus child 发一个 user steer。
- 通过条件：该混合执行得到 `mixed-source`；不能 finish/wait/track current；原 Delivery 不被错误消费；诊断不泄露其它入口标识。

### F. 图片读取与文本模型降级

- 用 user identity 发送一条含小型 PNG/JPEG 的 `@bot` 消息。
- 通过条件：Pet 只通过包内 patched lark-cli 的 fd3 seam取得 bytes；无具名下载文件；图片经 AttachmentStore 进入 typed image block；Delivery 入队前仍为 exact current。
- 若 route 支持图片：child 能基于图片答复。
- 若 route 不支持图片：typed queue 只失败一次，随后同一 current 纯文字 fallback 一次，并明确声明未查看图片；不得把 A fallback 投进 B。

### G. 旁路出站负测

- 在 child 会话检查可见工具；尝试请求 shell、`lark-cli`、`msg.py`、Python/Node/curl、subagent/workflow/Ralph/send_message 等能力。
- 通过条件：这些 inherited tools 不可见/不可执行；`run_code` 不可作为逃逸通道；caller-bound `pet_locus_finish` 仍可正常发送并落账。
- 不执行真实未知 HTTP 或凭据读取；负测的判据是能力面拒绝，不是尝试攻击生产平台。

## 轻量证据模板

```text
验收时间：
Host PID（前/后）：
目标群：答疑 · 伙伴对话调整2期
A 合法回复：PASS/FAIL；Delivery 状态/出站状态：
B reference-only：PASS/FAIL；是否零正文：
C 澄清→新 Delivery：PASS/FAIL；A/B 是否不同 Delivery：
D backlog：PASS/FAIL；顺序：
E GUI mixed：PASS/FAIL；拒绝码：
F 图片：PASS/FAIL；image/fallback 路径：
G 旁路：PASS/FAIL；被拒工具类别：
遗留诊断：
```

## 结束条件

全部七类通过后，勾选 OpenSpec task 7.3，并重新运行：

```bash
openspec validate pet-locus-delivery-safety-hardening --strict
```

随后才可声明 33/33，并进入 `/openspec-archive-change`。任一失败都保留 change 为 active，记录确定性原因，不以“稍后重试”替代分类。
