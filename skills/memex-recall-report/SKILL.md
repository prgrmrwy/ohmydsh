---
name: memex-recall-report
description: 统计 memex 记忆召回情况：读本机召回遥测，报告空结果率、仅正文命中率、从未被召回的卡片与最常返回的卡片，并给出处理建议。用户说「统计一下召回」「看看召回报告」「记忆好不好用」「哪些卡没被用过」「recall report」时使用。
whenToUse: 用户想了解 memex 记忆库的召回效果、死卡或检索质量时。不用于检索记忆本身（那是 memex_recall / memex_search），也不用于整理卡片网络结构（那是 memex-organize）。
---

# memex 召回报告

## 运行

```bash
bash ~/.dsh/skills/memex-recall-report/scripts/report.sh --days 14
```

- 不带 `--lib`：对 `~/.dsh-memex/` 下每个有 `cards/` 的库各出一份报告。
- 只看一个库：`--lib ~/.dsh-memex/personal`；库名与目录名不同时加 `--scope <名>`。
- 时间窗默认 14 天；用户说「这个月」「最近一周」时换算成 `--days`。

脚本会依次查找 PATH、`$DSH_HOME/profiles/*/node_modules/.bin/`、当前仓库构建产物。都找不到说明本机还没部署 dsh-memex，
请用户先 `dsh build`，不要自己去拼路径。

命令只读：只读遥测文件和卡片文件名，不写文件、不联网。可以直接运行，不需要先问用户。

## 解读

遥测只记判据，不记查询原文和卡片正文，所以报告回答不了「搜了什么」「哪条没找到」。
不要编造具体查询。

| 指标 | 含义 | 怎么判断 |
|---|---|---|
| `empty results` | 检索返回空 | 漏召回的候选。中文占比高时，看 `Chinese queries` 那行 |
| `only unanchored hits` | 返回了卡片，但查询词都没落在 slug/title | 大概率是正文凑数的噪声 |
| `NEVER RECALLED` | 时间窗内从未被任何检索返回的卡 | 要么没用，要么标题起得搜不到 |
| `MOST RETURNED` | 返回最多的卡；`anchored x/y` 是标题命中次数 | 次数高但 anchored 低 = 在误占结果位 |
| `hits without a scope` | 修复逐条归属之前写的旧记录 | 计入「已召回」但不归属库；只会越来越少 |

给结论时的三条纪律：

1. **样本量先行**。`recalls` 少于约 30 时，明确说「样本太少，只能看趋势」。几次检索就断言大半卡片是死重量不成立。
2. **「返回」不等于「有用」**。报告看不到某次召回有没有改变做法，这个只有用户知道。
3. **只给建议，不动卡片**。改标题、补 tags、合并、归档都要用户点头。批量整理走 memex-organize。

## 输出格式

先给一句结论，再列最多 3 条可执行建议，每条带具体卡片 slug。例如：

> 近 14 天 5 次召回，样本太少，只能看趋势。
> 1. `xxx` 被返回 2 次但 anchored 0/2，标题可能太泛。
> 2. …

多库时每个库一段。注意遥测是本机一份、不分库：`recalls`、`empty results` 等上半部分在每份报告里
都一样，只说一次；只有 `NEVER RECALLED` 和 `MOST RETURNED` 的归属是按库的。不要把各库的数字相加。
