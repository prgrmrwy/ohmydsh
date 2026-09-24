# 提交归属说明（2026-09-15）

`dsh-memex-scoped-memory` 这个 change 的 7 个文件分散在两条 commit 里，且第一条的
message 完全没有提到它。这里说明原因，避免后续考古时误判。

## 发生了什么

- `e5612c8 docs(openspec): 归档 drag-translate 与已被替代的 multi-binding 草案`
  包含该 change 的 `.openspec.yaml`、`proposal.md` 与 3 个 delta spec。

  这 5 个文件**与那条 commit 的主题无关**。当时该 change 正由另一个会话并行创建
  （文件时间戳 06:20–06:23，`design.md` 在提交前 13 秒仍在写入），而归档操作使用了
  `git add -A`，于是把这批进行中的文件一并提交。

- `798d943 docs(openspec): 补 dsh-memex-scoped-memory 的 design 与 tasks`
  由该 change 的作者补上剩余的 `design.md` 与 `tasks.md`。

两条合起来内容完整：`openspec validate dsh-memex-scoped-memory --strict` 通过，
7 个文件全部入库，没有内容被修改或丢失。

## 为什么不改写历史

`e5612c8` 已推送到 `origin/main`，且 `798d943`（他人的提交）建立在其之上。改写需要
force-push 已发布历史并连带重写他人提交，代价高于这条说明本身的价值。

## 操作教训

多会话并行写同一仓库时，提交前应显式列出本次改动涉及的路径，而不是 `git add -A`。
`git status` 里出现的未跟踪文件未必属于当前任务。
