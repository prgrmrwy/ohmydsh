## Why

`dsh-magpie-connector` 的线路面板在配置完成后仍然默认展开当前生效线路，四个文字按钮（上移 / 下移 / 删除 / 展开）在窄宽度下挤占主机名与状态；用户想判断「这条线路网络质量怎么样」只能切过去试一次，面板本身不给任何即时反馈。用量条填充末端是直角，与轨道圆角不一致，看起来像被截断。

本 change 只做体验优化，不改线路 schema、不改自动选择语义、不新增凭据或网关接口：把行头部做成点击切换 + 常驻图标操作，默认收起已配置的线路，并在打开面板时对每条线路做一次点状 TCP 建连测速。

## What Changes

- **用量条圆角**：窗口用量条的填充段两端改为与轨道相同的 3px 圆角，部分进度时末端也不再是直角。
- **默认收起**：设置页加载已完成配置时，所有已保存线路折叠为一行（不再默认展开 active）；首次安装添加第一条线路、以及新增备用线路时，该新行仍自动展开供填写；保存等设置刷新不再把用户正在编辑的行收起。
- **操作图标化（DSH 产品图标）**：行内「上移 / 下移 / 删除」由文字按钮改为常驻图标按钮，图标直接取自 DSH 产品图标集 `@deepseek-ai/dsh-client-ui-primitives` 的 Regular 版本（1px stroke、`currentColor`、16px 视觉盒）：上移 / 下移用 `IconChevronUpOutlineRegular` / `IconChevronDownOutlineRegular`，删除用 `IconTrashOutlineRegular`，展开 / 收起用 `IconTriangleRightFillRegular`（展开时旋转 90°）；每个图标按钮带 `aria-label` 并用 DSH `Tooltip` 显示中文动作名，「展开 / 收起」文字按钮移除。
- **头部点击展开**：覆盖序号、active 方块、主机名与延迟位的切换控件（原生 `button`、`flex:1`、鼠标 pointer）是点击/聚焦目标，带 `aria-expanded`，展开时才带指向编辑内容的 `aria-controls`（折叠时编辑内容不渲染）；操作图标位于切换控件之外，点击操作不会误触展开。`data-expanded` 与 `data-line-id` 语义保持。
- **线路延迟（FPS 风格）**：打开设置面板时自动对**所有已保存且地址可解析的线路**做一次 TCP 建连计时（并行、单条截止 ≤600ms、不发 HTTP、不带凭据；含 DNS 解析）；面板先显示「测速中…」，随后每行显示 4 格信号条 + 毫秒数：≤100ms 4 格、≤250ms 3 格、≤450ms 2 格、≤600ms 1 格、600ms 内未完成建连显示「超时」（0 格），请求失败（含旧 host 404）显示「—」。读数只代表这一次打开面板时的网络质量：不参与自动选择、不读写选择探测缓存、不持久化、不做定时轮询；线路保存成功后重测一次（地址可能已变）。
- **新增 host 只读资源** `GET /api/dsh-magpie-connector/latency`（只接受 GET）：返回 `{lines: [{id, ms}]}`，`lines` 只含已保存且地址可解析的线路，`ms` 为建连耗时整数毫秒或 null；同一时刻只有一组测量（并发 GET 共享同一次结果），dispose 时中止悬挂测量；不写 settings、不改变 `activeLineId`。
- **info 说明补充**：延迟是 TCP 建连耗时（含 DNS 解析），不是网关健康检查；多条线路仍应指向同一个 Magpie 网关。info 图标保持 hover 说明，同时把同一文本放进可聚焦元素的可访问名称，让键盘用户也能获得说明。
- **非目标**：手动选择或强制线路；延迟定时刷新 / 历史曲线；HTTP 或 TLS 级真实延迟；删除二次确认；拖拽排序；线路 schema 或凭据变更。

## Capabilities

### New Capabilities
- 无。本 change 不新增 capability，全部落在既有 spec 上。

### Modified Capabilities
- `magpie-line-selection`：**修改**「自动选择规则」（把「SHALL NOT 探测」限定为「为选择目的」，行为不变，消除与线路测速的字面冲突）、**移除**「active 展示」（旧规则「默认只展开 active」被整体取代，REMOVED 里写明 Reason / Migration）、**新增**「线路展示与展开」（默认收起、首次/新增展开、新建线路首次保存换新 id 仍展开、保存失败不改展开状态、头部切换控件、`data-expanded` 保留）、修改「静默规则与 info 说明」（补延迟是 TCP 建连耗时、不是健康检查）、**新增**「线路延迟展示」（`data-latency-*` DOM 契约、四档阈值与颜色、measuring/idle/超时/failed 态、不新增 alert/status/aria-live）与「线路测速范围与独立性」（测速对象、打开/保存后各测一次、不轮询不持久化、独立于自动选择探测缓存）。
- `dsh-magpie-connector`：修改「用量入口与颜色（AMD4）」（填充段圆角，断言 `settingsCss` 声明）、修改「只读与传输边界」（可达性探测仍只限「参与自动选择的完整线路」；新增设置页测速例外「已保存且地址可解析的线路」；两者都限制为 TCP、无 HTTP、无凭据、≤600ms）、**新增**「线路测速资源接口」（GET-only 响应形状、空地址不出现在响应）与「线路测速生命周期」（并发共享一次测量、dispose 中止悬挂测量、不写设置不改选择）。

## Impact

- 代码：`packages/dsh-magpie-connector/src/client/{SettingsPage,styles,api,index}.ts` + 新增延迟展示小模块，并更新 `api.ts` 与 `client/index.ts` 中「三个 D10 资源」的过时注释；`src/host/{latency,routes,selection}.ts`（新增测量控制器与计时探测，复用现有 socket 收口逻辑）。新增 peer/dev 依赖 `@deepseek-ai/dsh-client-ui-primitives@^0.2.0-rc.2`（与 DSH pin 同版，运行理由：图标与 Tooltip 由 Web 壳提供模块，auto-model-routing 已有同款先例）；host 侧无新依赖（`node:net`）。
- 依赖与构建：变更依赖前需先 `ws promote`（worktree 依赖只读缓存）；`vitest.config.ts` 需要像 auto-model-routing 一样把 primitives 别名到测试 stub，`tsdown.config.ts` 的 `external: [/^@deepseek-ai\//]` 已覆盖运行时外部化。
- 测试：`test/line-active-ui.test.tsx` 场景随默认收起改写；新增头部切换、图标操作、延迟展示（测速中 / idle / 四档 / 超时 / failed / 404）UI 用例与 host 测量、GET-only、单飞、dispose 不写设置用例；`test/dispose.test.ts:9` 的精确资源路径数组与 `release` 调用次数（3 → 4）要更新，`test/feature-wiring.test.ts:12` 只改标题里的「three resources」表述（它对资源数量没有断言）。默认收起会卸载编辑体，`test/access-ui.test.tsx` 以及任何直接操作线路编辑控件的 settings-render 用例需要先展开目标行（新增 `expandLine` 帮助函数）；所有渲染设置页的 fixture 需要补 `GET latency` 处理器或显式断言未映射时的 404 降级；`test/line-silent-ui.test.tsx` 的 info 图标断言改用稳定锚点（`.dmg-info` 或 `[title^="线路按序号"]`，不按会变化的 `aria-label` 精确匹配）并补 `aria-label` 校验。
- API：新增第 4 个 D10 资源（GET-only）；`docs/internal-api.md` 更新；包版本 0.3.1 → 0.4.0 并记 CHANGELOG，`dsh.yaml` 中该 local package 的 `version` 一并同步（manifest 与 package.json 由约定保持同版）。
- 发布资产：`docs/settings.png` 会过期，按 `docs/SCREENSHOTS.md` 复拍并更新该文件的截图台账行（source/date/reviewer/verdict）；README 双语不涉及能力变化，仅在必要时补一句延迟说明。
- 安全：测速只建 TCP 连接，不带任何凭据、不发 HTTP；响应只含线路 id 与毫秒数，不含 key/Access；脱敏与凭据路径不变。
- 升级影响：无 settings / 凭据格式变化，无迁移；旧版客户端不会请求新资源，新版客户端在旧 host 上降级为 `failed`（显示「—」），404 与其它非 2xx 走同一条静默降级路径。
