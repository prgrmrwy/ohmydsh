# 发现型未声明库删除：验收摘要

结论：**FAIL**。本轮使用已确认的规范断言、隔离本地宿主和一次性真实库，采用串行真实浏览器操作。计划修订号为1；本项有17个checkpoint、16条原oracle。

执行基线：ohmydsh `32b9e763`、DSH `0.2.2-rc.1`、dsh-memex `0.4.7`、内核 `0.4.1`，专用 Host 端口 `58271`。后续同步上游不回填本轮结果。

| pass | fail | partial | blocked | manual | pending |
|---:|---:|---:|---:|---:|---:|
| 11 | 2 | 0 | 3 | 1 | 0 |

两卡发现库首次确认显示真实绝对路径与2卡，首次及取消均无delete请求，库内容保持。宿主对已声明库返回refused/declared，对另一scope同home的发现库返回refused/busy，目录和卡片保持。

真实权限场景包含同UID及unlink EACCES前置证明；GUI删除实际返回refused/failed和ENOTEMPTY，目标两卡、相邻空库、第三保护库及配置保持。

两卡库二次确认后原生返回status=ok、home和cards=2，物理目录确实消失，请求仅含scope。D07 FAIL：页面结果没有本次2卡计数；D08 FAIL：8s等待超时，原窗口165.48s仍有该未声明条目。

D10缺真实第4工作区，普通GUI尝试未完成，未使用隐藏API或伪造条目，也未对第三保护seed发delete；D11缺安全可达的非namespace形状fixture。D15在原窗口耗尽后没有提交空库删除，空库仍存在。

人工截图观察到确认区域横向裁切，库名/路径前缀及按钮字样不完整；完整字符串在DOM中，视觉可读性仍需人工复核。

本摘要列出的状态来自执行脚本统计；没有把前置缺失、受污染输入或时限耗尽当作通过。原始执行证据与正式报告已保存到仓库外 `~/.dsh-memex-eval/library-management-acceptance-20261108-37d8a8c5/checking/dsh-memex-delete-undeclared-library/report.md`，同目录树有逐文件哈希清单；目录0700、文件0600。

**oracle 与实现同源，绿不等于免人工**。本轮不包含单元测试、项目接口e2e、安全扫描、性能或维护性评估。
