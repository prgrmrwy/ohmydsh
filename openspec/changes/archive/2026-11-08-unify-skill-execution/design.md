## Context

两个skill会各自复制到部署目录，不能依赖仓库根模块或另一个skill。已有产品CLI本身是Node；Bash仅做发现、默认多库和转交。主干report默认排除eval-*，须保留。

## Goals / Non-Goals

目标：相同Node命令可在无Bash的原生Windows执行。只维护一套辅助逻辑。
不涉及：Host工具bash的语义、PowerShell/AppleScript平台适配、额外script授权或生产部署。

## Decisions

- 每个入口独立且只用Node内置模块。分别实现少量不同的发现规则，不建立额外安装包或跨skill共享路径。
- PATH优先。POSIX已安装可执行CLI直接以argv执行；Windows只执行exe或通过所属npm包manifest中的已知bin入口调用当前Node，不解析cmd/ps1文本、不依赖Shell quoting。
- memex依次查PATH、DSH_HOME profiles的dsh-memex包、cwd所属Git仓库构建产物；ws查PATH和Git仓库。包查找校验name/bin及入口位于真实包目录。缺少CLI非零，不安装。
- 所有可变argv用spawnSync shell:false；Windows隐藏控制台。单次CLI失败不尝试别的副本。
- 旧sh exec相邻mjs，不保存业务逻辑；skill文档使用Node入口。

## Risks / Trade-offs

- Windows shim布局差异 → 只支持可证明npm包入口和exe，未知shim清楚拒绝；无执行Shell fallback。
- shell脚本过去受shell glob排序影响 → 默认按库名排序，保留最后非零状态和eval排除。
- 老profile不自动更新 → 本次只改真相源；用户之后build会物化，不重启现役服务。

## Migration Plan

先通过独立fixture RED确认Node入口缺失，再实现和聚焦回归；将测试加入Windows driver，跑Linux完整和原生Windows无Bash合同。代码回退可用git恢复旧skill；保留历史薄sh路径不破坏既有调用。
