# Settings启动期消失：专项时序诊断

用户在第13轮明确选择继续专项时序诊断。范围为devbox隔离候选，原生Chromium观察，不修改产品源码，不改配置，不强制点击。

## 可复核观测

两次全新browser context：

|事件|运行A（毫秒）|运行B（毫秒）|
|---|---:|---:|
|点击Settings|1830|1614|
|Memory内容出现|1927|1711|
|workspaces HTTP200|2151|1853|
|工作区行加入DOM|2166|1858|
|Memory和Settings整体消失|2223|1886|

点击日志只有Settings、Memory；消失前无关闭点击、无新navigation。stores随后仍200。worktree-session/session-status400发生在消失之后，不能据此归因。

运行B被动观察12秒后，通过普通按钮重新打开Settings→Memory；5秒后仍存在[data-shortcut-modal=settings]，acceptance-scope行可见，断言PASS。全程不保存配置。

## 源码边界与假设

目标官方源码packages/client/ui-settings-general/src/client/SettingsRoot.tsx：
- 134–143行：onboardingActive基于sessions phase=ready及main session blank状态。
- 150–158行：若onboardingStep由undefined变为存在，且Settings已打开，调用close()。注释明确是避免设置面板留在onboarding蒙层之后仍可聚焦。
- 模态关闭另有mask/header/Escape入口（49–61、69、93行）。

第13轮只确定候选原因；第14轮补到直接分支证据：对浏览器加载的ui-settings-general/client.js响应仅插入诊断回调（唯一匹配`if (appeared && open) close();`），保留原close控制流。2649ms记录branch=onboarding-close、step=welcome-notice、open=true、appeared=true；2652ms Settings与Memory DOM消失。故本次启动期弹窗消失可归因于官方onboarding自动关闭分支，而非仅凭相关时序推断。没有更改磁盘上的源码/部署产物。

另用全新、不拦截资源的浏览器对照：先普通打开Memory，等待Settings实际消失后再普通重开，按acceptance-scope精确定位行，正常点击Show details。断言scope名正确、独立home输入可见、Hide details的aria-expanded=true，全通过。无force click、JS click、CSS修改或设置写入。

## 结论与下一步

- 已把失败边界收窄为启动期整个Settings模态生命周期，不是单一Memory控件一直被遮挡。
- 工作区结果200且实际行出现；Paths with no workspace的开关禁用与其无path配置一致。
- 后启动普通重开及指定行详情展开已通过，但没有验证编辑、保存或刷新；完整UI门禁仍未通过。
- 关闭原因已获得分支运行证据，下一步可在已知启动生命周期后继续原生编辑验收，无需修改Memory CSS或绕过onboarding保护。不把这次探针同步修正包装成产品修复。

两轮候选PID2412442、2418574均已核cmdline与DSH_HOME后SIGTERM，exit0；第14轮repo与.upstream均clean；生产3080仍PID2004366。没有本机DSH/VM变更、远端发布或正式pin变更。整体升级NO-GO。
