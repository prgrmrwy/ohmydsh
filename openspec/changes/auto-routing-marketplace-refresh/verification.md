# 发布/商店进度（2026-10-26）

- 当前206测试/typecheck/build/pack通过；独立镜像目录自有node_modules install/typecheck/206tests/build通过；打包tgz另目录安装并import Host apply成功，无生产依赖借用。
- 双语README延续安装/使用/须知/架构/开发/移除结构，旧四档与selectModel说明移除，旧GIF折叠为legacy/mock历史。披露外发/自定义key信任/无真实teammate/无收益对照边界。
- 源提交c91a06a6；subtree cdfa2db；独立镜像保留原历史merge为6973e0d，非强推。
- GitHub v0.4.0 Release与预构建tgz已上传：https://github.com/prgrmrwy/dsh-auto-model-routing/releases/tag/v0.4.0 。资产sha256:02e7fdab1962bcac4e5b00fd58fcaaeb5180106b1aa1ee59790330c24accf58c。
- npm本机whoami E401；现有OIDC workflow安装验证通过，publish E404/无权限：https://github.com/prgrmrwy/dsh-auto-model-routing/actions/runs/40213176268 。registry latest仍0.3.0，不声称0.4.0已npm发布。需要owner在npm package settings验证Trusted Publisher GitHub owner prgrmrwy、repo dsh-auto-model-routing、workflow release.yml并允许发布；不要聊天传token。
- 商店当前规则实际读取；无既有条目，仓库年龄>1day，dsh-plugin topic已有。model类单条YAML validateEntries全量[]，带钉住版本的GitHub release tarball。
- PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9455 。截至记录OPEN，新提交CI等待/重跑，维护者未合并；不声称已上架。

外部待办：npm授权与发布、商店CI/人工审核。Git安装或Release tgz可获取0.4.0；npm不加版本仍旧版。未更新录屏（避免把mock旧界面当新版），未承诺商店合并时间。
