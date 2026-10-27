# Viewer 实施记录

## 前置核验（2026-10-27）

基础skill已实施、真实集成验证：Python89测试无skip；npm645/643pass/0fail/2既有skip；check:artifacts GREEN；核心4组独立review发现已focused关闭。共享_model的calculate_status(root, check_assets=False)、read_observations可关闭资产检查，不在只读路径创建锁，最小fixture recipe可生成2oracle/3checkpoint/5观察。前置change的私有adapter迁移/部署仍是未授权后续事项，不代表基础模型未实现。

基础change任务中004/005/006/008/038/041/044/047与wrapper065未留下自身RED见证（初次已被先前实现覆盖），仍如实留未勾选，不制造历史失败；所有对应行为测试当前green。Viewer本轮只在以上基础能力验证后开始。

## 分工

- evidence-recovery：build_catalog.py、view.py、test_catalog.py、test_view_server.py。
- viewer-ui：四个viewer前端文件、tests/case-verify-viewer.test.mjs；adapter-core启动失败后接替，没有双写。
- Lead：SKILL view流程说明、集成、真实浏览器与独立评审。

不读取外部原型data，不新增依赖，不启动替代DSH服务；viewer独立loopback服务必须受管job，向用户交付前health验证。真实浏览器工具agent-browser0.39.1可用，尚未进行视觉验收。

## 实施与验证

- 前端9个生产mount/logic测试先在可导入行为stub上RED，再9/9GREEN；补checkpoint关联oracle expected搜索遗漏时再次RED修复。后端20个映射场景先stub行为RED，额外回归部分已GREEN如实记录。
- Lead独立全Python：116tests OK /42.656s，无skip；Node前端9/9pass。结构/路由安全额外覆盖HEAD/DOM/JPEG、errorheaders、debugout、crossloopfail、badstructure。
- 真实浏览器agent-browser0.39.1，独立session case-verify-preview，仅合成fixture：就绪行后health200；双视角、checkpoint C1深链、superseded/expired、derived、pending筛选、search无结果、NOPE深链提示、HTML字面渲染均实际复读。1×1合成PNG lightbox打开后complete=true/naturalWidth=1，Escape关闭；390×844移动viewport documentWidth=390无横向溢出，实际截图目视检查。未接触真实来源/证据或3080GUI。
- screenshot CLI首次把filename当selector，读help后改用默认viewport截图；body元素截图受长页面clip/滚动影响不作为完整外观证明。部分agent-browser open报告daemon临时无响应，未把该次调用当成功；后续hash/DOM断言独立确认页面实际状态。
- 管理job bash-486本地服务在验收后SIGTERM回收，专用browser session已关闭；没有遗留服务。截图/合成fixture本地保留不入库。

## 独立评审

core-reviewer独立读取完整viewer契约和实现，catalog14+server13+Node9测试均通过。唯一Important：catalog分别读取state/history，正常worker在中间追加fail会出现pass汇总与fail时间线矛盾。backend作者确定性RED复现后补结构文件名→字节前后检查，最多3次只读重试，无锁/cache写入；单次追加第2次返回一致fail，持续变化第3次友好拒绝。core-reviewer独立重跑原repro与16catalog测试，确认原Important关闭。其余投影/路由/字面渲染/汇总稳定输入边界未发现新阻塞。最后fresh npm test：654tests/652pass/0fail/2既有MCPskip，exit0；全Python118tests通过。viewer任务78/78已记录，但verify保留FAIL因为full-suite zero-skip硬条件仍不满足，未把既有skip当豁免或PASS。
