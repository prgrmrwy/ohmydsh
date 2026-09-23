# Attribution — skills/eli5

Vendored verbatim from the upstream ELI5 skill repository.

| | |
|---|---|
| 上游 | https://github.com/DreambigOu/ELI5 |
| 路径 | `skills/eli5/SKILL.md` |
| 版本 | commit `a766623b062331fdde53467001379b4ddf3acc2f`（2026-03-17） |
| 许可 | MIT License（全文见同目录 `LICENSE.txt`） |
| 本地改动 | 正文逐字未改；frontmatter 追加了一条 `whenToUse`（见下） |

MIT 许可要求再分发时随附许可与版权声明，故在本目录内保留上游 `LICENSE`（重命名为
`LICENSE.txt`，与 `skills/frontend-design` 保持一致）。本仓库 `github.com/prgrmrwy/ohmydsh`
是公开仓，逐字复制即构成再分发，这一项是合规要求而非惯例。

## 唯一的本地改动：`whenToUse`

上游 `description` 的触发面很宽（"Even partial matches like 'explain to my wife'…
should trigger"），在 DSH 这种通用编码会话里会被日常说法误命中。追加的 `whenToUse`
只收窄触发条件，不改变任何解释行为；上游正文一字未动，因此升级时仍可直接与上游
`SKILL.md` 做 diff，只需保留这一行。

同 skill 树内的 `i-have-adhd` 采用另一条路线（中文化重写、出处写在正文）——本 skill
选择「逐字 + 最小 frontmatter 补丁」，是为了保住与上游 diff 的能力。

未纳入本仓库的上游内容：`eli5-workspace/`（run-evals.py、evals.json、eval-results.md 等）
是上游自用的评测脚手架，依赖 Claude Code CLI 和 `~/.claude/skills/eli5/` 路径，与 DSH
的 skill 装载通道无关，故不 vendor。需要复跑评测时回上游仓库执行。

升级方式：复核上游新 commit → 覆盖 `SKILL.md` → 更新本文件的 commit 与日期 → 在 `dsh.yaml`
对应条目的 `note` 里更新记录。
