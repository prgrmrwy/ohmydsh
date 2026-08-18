---
name: add-dsh-plugin
description: 往 zydsh 定制仓添加远端 DSH 插件:先写 manifest(dsh.yaml),再 dsh build,然后询问用户是否重启 DSH。
whenToUse: 用户要求安装/添加某个 DSH 插件(给出包名、npm 链接、awesome 列表条目,或说"想装 xxx 插件")时。
---

# 添加远端插件(add-dsh-plugin)

目标仓库:/Users/bytedance/mydir/opensource/zydsh(DSH 定制仓)。

## 流程(严格按序)

1. **核实来源**:`npm view <包名> version repository.url description` 确认包存在、拿精确版本与源码仓库;查不到就停下来问用户。安全约定:第三方插件 = 第三方代码,快速看一下源码仓库(README / issues),把结论写进 note。
2. **写 manifest**:在 `dsh.yaml` 的 customizations 末尾追加条目。若该包已有条目,视为升级:只更新 `spec` 与 `version` 为新的精确 pin,不要重复加行。
   ```yaml
   - id: <短横线id>
     type: package
     source: remote
     spec: <包名>@<精确版本>
     version: <精确版本>
     enabled: true
     brief: <一句话用途(启动清单短备注,优先于 note)>
     note: <repo 链接 + 用途与审查结论>
   ```
   版本必须精确(禁止 ^/~);id 用短横线命名,可与包名不同;`brief` 显示在 `dsh` 启动清单的插件行后,`note` 做完整来源/审查记录。
3. **build**:执行 `dsh build`(等效 `node scripts/sync.mjs`),确认输出:插件安装成功、bundles 更新、无失败条目。失败 → 报告错误并停止,不进下一步。
4. **询问重启**(必须问,不得擅自重启):问用户是否现在重启 DSH 使插件生效,给出两个选项:
   - **立即重启**:请用户自己执行 `dsh stop && dsh`——重启会中断当前会话,所以由用户执行,agent 不要执行 `dsh stop`;
   - **稍后手动重启**:插件已装好,下次 `dsh` 启动自动加载,什么都不用做。
5. **收尾**:按用户选择说明即可;重启后可用 `dsh` 的输出清单或 `dsh history` 确认新插件已加载。
