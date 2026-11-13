# 主入口切换携带卡片：验收摘要

结论：**needs-human**。本轮使用已确认的规范断言、隔离本地宿主和一次性真实库，采用串行真实浏览器操作。计划修订号为1；本项有18个checkpoint、17条原oracle。

执行基线：ohmydsh `32b9e763`、DSH `0.2.2-rc.1`、dsh-memex `0.4.7`、内核 `0.4.1`，专用 Host 端口 `58271`。后续同步上游不回填本轮结果。

| pass | fail | partial | blocked | manual | pending |
|---:|---:|---:|---:|---:|---:|
| 10 | 0 | 4 | 3 | 1 | 0 |

GUI迁主入口时观察到来源cards/archive缺失文件进入目标，目标冲突副本保留；迁移期间来源字节保持。忙态与真实新Session的注册memex_recall已取证。

P14在专用Host冷重启后的独立epoch完成：仅直接编辑配置，原来缺失的来源卡出现于目标且SHA256相同，实际路由为新scope/home。重启是场景基线，不是产品修复，不消除P11。

P05/P16的计数或日志、P08告警、P10精确调用次数证据不足，保留partial；P06/P12严格时序及全内核调用轨迹缺证据，P11附加入口阶段实际未就绪，保留blocked。P-T3停止后没有重跑或延长。

本摘要列出的状态来自执行脚本统计；没有把前置缺失、受污染输入或时限耗尽当作通过。原始执行证据与正式报告已保存到仓库外 `~/.dsh-memex-eval/library-management-acceptance-20261108-37d8a8c5/checking/dsh-memex-primary-switch-carries-cards/report.md`，同目录树有逐文件哈希清单；目录0700、文件0600。

**oracle 与实现同源，绿不等于免人工**。本轮不包含单元测试、项目接口e2e、安全扫描、性能或维护性评估。
