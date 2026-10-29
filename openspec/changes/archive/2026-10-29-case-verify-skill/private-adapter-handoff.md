# 私有 adapter 独立会话交接

## 已获用户确认

在私有overlay仓独立绑定会话实施，仅新增case-verify-adapters/（oracle-source、report-sink、私有关键词扫描与合成测试），单独提交；不改.env.local/日常配置，不部署、不重启、不unlink。内部链接阶段1验证由用户参与。公开会话受managed-root限制，不能直接跨仓写入。

## 公开侧契约

公开实现位于skills/case-verify/scripts/adapters.py与references/oracle-adapters.md，Python3.9+标准库。CASE_VERIFY_ADAPTERS是冒号分隔的可信可执行目录；脚本以用户权限执行，非沙箱。

- --describe输出JSON对象，name安全唯一slug；oracle-source需要kind、match正则、provenance；report-sink只需要kind/name。
- 来源调用：`<exec> fetch <url> --out <独立调用目录>`；写oracle.fragment.json={items:[...]}，每项字段与公开oracle schema一致；wrapper覆盖provenance/source并跑fragment门禁。失败不得输出可合并片段；内部图片只存来源目录，不混同执行证据。
- 输出调用：`<exec> push <checking-dir>`；已有外部URL经CASE_VERIFY_EXTERNAL_DOC_URL传入；stdout末行http(s)URL。包装器会先fresh执行--require-report门禁，失败零调用。私有sink仍应谨慎处理失败，不能改变本地报告/观察事实。
- timeout300秒，--describe10秒，日志只保留尾4KiB；路径不得经symlink逃逸；重复拉取不覆盖。

## 私有实现任务

1. 读取原私有来源适配和文档输出实现，保留URL解析、节点映射、认证前提、分页/配图与追加loop语义；不把内部值带回公开仓。
2. 先以合成假CLI/本地数据RED测试描述、匹配、fetch映射、图片和失败残留、sink创建/更新/失败URL不变，再最小GREEN。
3. 私有关键词扫描只在私有仓保存规则，对公开skill目录做只读检查；测试必须能发现注入的内部形状，不打印敏感原值。
4. 与公开wrapper的真实fragment门禁、push报告门禁集成；验证无未授权网络外发/无环境配置修改。
5. 提供用户可运行的阶段1验证步骤与必要登录前提，等用户参与；不自动触发真实报告外发。
6. 独立评审、记录命令计数并单独提交。交回公开会话仅脱敏结论、commit标识与是否通过，不回传原用例/身份/凭据。

## 不作完成声明

本文件是交接，不是已实现的私有adapter。当前公开会话没有创建私有绑定会话的工具，需用户在目标仓打开会话后继续。不要通过普通bash/read跨根绕过绑定。
