# skills/ — skill 定制

[English](README.md) · 简体中文

<!-- problem -->
skill 是 agent 可以按需加载的一组针对特定任务的可复用指令。这个目录存放本仓库随附的 skill，让同一份真相源不论会话工作目录在哪，都能到达这台机器上的每个 DSH 会话。

每个子目录 = 一个 skill，DSH 分层源格式：

```
skills/<name>/
  SKILL.md            # 必须:skill 定义(带 name/description 的 markdown)
```

- sync 把 `skills/<name>` **复制**到 `~/.dsh/skills/<name>`（user-dsh 源，全局可用，不依赖会话 cwd）；
- DSH 其他可用源（备查）：项目根 `.dsh/skills/`（project-dsh）、`.agents/skills/`（project-agents，openspec 技能所在）。
