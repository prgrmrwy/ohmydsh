# skills/ — skill 定制

每个子目录 = 一个 skill,DSH 分层源格式:

```
skills/<name>/
  SKILL.md            # 必须:skill 定义(带 name/description 的 markdown)
```

- sync 把 `skills/<name>` **复制**到 `~/.dsh/skills/<name>`(user-dsh 源,全局可用,不依赖会话 cwd);
- DSH 其他可用源(备查):项目根 `.dsh/skills/`(project-dsh)、`.agents/skills/`(project-agents,openspec 技能所在)。
