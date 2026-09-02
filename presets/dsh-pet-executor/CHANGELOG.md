# dsh-pet-executor

## 0.1.0

- 从官方 `standard` 复制，移除 `skill-filesystem`。

  Pet 的规范要求：只有在 Pet 允许清单中显式启用的 Skill，才可以对执行会话
  发布、加载或注入。Pet 注册了自己的 scoped provider，但 scoped 注册是
  **加法**——`dsh-skill` 的 `collectFresh` 始终把 global 层并入合并结果，
  provider 无法减去 preset 带进来的另一个 provider。因此排除它的唯一办法
  是不在这里加载。

  保留 `tool-skill`：执行会话仍需要目录与加载器，只是它看到的目录完全来自
  Pet 的允许清单。
