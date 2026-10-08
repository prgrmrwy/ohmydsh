# Pet真实只读UI：任务空状态与轮盘交互通过

## 被测来源

devbox隔离候选0.2.0-rc.2，原repo83c69cf launcher；部署配置由上一轮frozen-sync-fixture生成，修复header/bridge文件与审查构建cmp一致。无插桩Chromium1600×1000，无API stub、force点击或CSS修改。

本轮仅实际读取现有空任务状态，不创建Task/Invocation/Locus，不发送模型或飞书请求。开始前读过docs/notes/dsh-plugin-integration-pitfalls.md和overlay.tsx实际交互实现。

## 两次真实浏览器结果

- 普通点击aria-label=DSH Pet按钮，Pet tasks dialog出现，按钮aria-expanded=true。
- 普通切换Current/All/Archived，aria-selected分别正确；三者taskRows=0，显示No task for the current source yet. / No all tasks. / No archived tasks.。
- 面板没有dshpet-error提示；普通再次点击关闭。
- 按钮聚焦后ArrowUp打开Pet能力menu，Escape关闭，均断言通过。
- 页面pageerror为0（不等于全页面console/网络零错误，未作该声明）。
- Pet config/status/capabilities/channel/tasks请求全部HTTP200。
- 第二次采集所有Pet请求path/method，全部在以上读取路由allowlist内。RPC虽用POST传输，语义是读取；未请求invoke、locus创建、channel-mutate/bind等变更端点。

两次probe均exit0；onlyReadRoutesRequested=true。响应200只证明读取可用，未依据HTTP200宣称能力非空或Pet全部ready。

## 清理与门禁边界

候选PID2441388核cmdline/DSH_HOME后SIGTERM正常exit0；生产3080仍PID2004366，原repo clean。未变更本机DSH、VM、正式pin或发布。

这补充5.7的只读轮盘/面板基础证据，不能勾选5.7整体：实际能力运行、executor preset装配、精确child Session导航、locus fork/independent冷恢复、SQLite单writer、真实飞书入口/媒体仍未覆盖。空任务不能用于验证有任务行的openSession行为。5.1/5.6/5.8仍未完成，整体升级NO-GO。
