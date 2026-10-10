# skills/ — skill customizations

English · [简体中文](README.zh.md)

<!-- problem -->
A skill is a reusable set of task-specific instructions an agent can load on demand. This directory is where the skills this repository ships live, so that one source of truth reaches every DSH session on the machine regardless of its working directory.

Each subdirectory is one skill, in the DSH layered source format:

```
skills/<name>/
  SKILL.md            # required: the skill definition (markdown with name/description)
```

- Sync **copies** `skills/<name>` to `~/.dsh/skills/<name>` (the user-dsh source: globally available, independent of the session's cwd);
- Other DSH skill sources, for reference: the project-root `.dsh/skills/` (project-dsh) and `.agents/skills/` (project-agents, where the openspec skills live).
