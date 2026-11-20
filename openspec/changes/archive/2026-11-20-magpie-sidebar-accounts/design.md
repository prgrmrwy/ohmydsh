## Context

- 侧边栏额度卡：`src/client/sidebar-view.ts`（纯函数：`sidebarRows` 决定每张卡显示哪些窗口）与 `src/client/SidebarUsage.ts`（`compactRow` 收起形态、`detail` 展开形态）。每张网关卡片渲染为一个独立块，名称取 `card.name ?? card.provider`，React key 为 `cardIdentity(card)` = `provider + user`。
- 设置页 `UsageCard.ts` `WindowRow` 只在读数以 `%` 结尾时画进度条；读数规则与侧边栏 `windowReading` 相同（无限 → display → used%）。
- 网关事实（家庭 Magpie 0.1.4499）：同一 provider 多账号为多张卡，各带 `user`、`plan`；Codex 卡含 `{name: "Image generation", used: 0, display: "Unknown"}`；卡片 `routing` 字段是窗口数组而非分配方式。
- 视觉稿（用户 2026-11-20 确认）：紧凑形态保持现有每窗口一行、到期时间、读数与进度条，只把同厂商的多张卡归到一个厂商名下，账号名打头；展开形态每个账号显示自己的全部窗口。

## Goals / Non-Goals

**Goals:** 同厂商多账号可辨认；不减少现有信息；文字读数不再配 0% 进度条；与设置页规则一致。

**Non-Goals:** 显示分配方式；按账号改设置页；改紧凑形态的窗口选择规则；对 `user` 做脱敏或改写。

## Decisions

### D1 分组发生在渲染层，`sidebarRows` 仍逐卡计算
新增纯函数 `sidebarGroups(rows)`：按 provider 首次出现顺序分组，组内保持网关顺序；组内第 i 张卡的账号标识为 `user`，缺失时为「账号 i」（从 1 起）。单卡组不带账号标识。窗口选择仍由 `sidebarRows` 按卡计算，不改。
- 否决：把多张卡合并成一张。会混淆各账号的窗口与重置时间。

### D2 收起形态
多卡组：一行组标题「厂商名 · N 个账号」；每张卡沿用现有 `compactRow`，只把原来的名称位置换成账号标识（`user`，附 `plan`）。单窗口仍是单行布局（`账号 (7 days) 到期 读数` + 进度条），多窗口仍是「账号一行 + 每窗口一行」。单卡组完全不变。
- 账号行中账号标识元素（`.dmg-sidebar-account`）是唯一可收缩的元素（`flex:0 1 auto; min-width:0`，`text-overflow:ellipsis`），`plan`、窗口名、到期时间、读数都 `flex:none`；`title` 给账号全文。
- 多窗口卡片：组标题之后，该账号先占一行（账号标识 + plan），再每个窗口一行，各带进度条，即原「上游名称单独一行」的位置由账号行代替。
- 组内某账号读取失败或只有余额时，该账号行按单账号时的失败 / 余额规则显示，其它账号不受影响。
- `user` 缺失、空串或只有空白时视为缺失，按组内序号显示「账号 N」；同组中其它账号有 `user` 时照常显示。
- 测试钩子：组容器 `data-dmg-sidebar-group=<provider>`，账号标识 `data-dmg-sidebar-account`。

### D3 展开形态
多卡组：组标题一次；每张卡的段落标题由厂商名换成账号标识，元信息仍为 `plan · 读取时间`。单卡组不变。

### D4 进度条与数字读数
窗口的读数显示为「无限」或 `display` 文本时：不画进度条、读数不带 `data-level` 颜色、不参与「读数最高的窗口」回退选择；展开形态同样不画。**档位匹配不变**：勾选档位仍按窗口名匹配有有限 `used` 的窗口（含同时带 `display` 的窗口），匹配到的窗口照常作为该档位行显示 `display` 文本，只是没有进度条。与 `UsageCard.WindowRow` 一致。仍可作为最后一级的 display/无限回退显示文字。

### D5 React key
多张卡可能 `provider` 与 `user` 都相同（`user` 缺失），key 改为 `cardIdentity` 加卡片在结果中的序号，避免重复 key。

## Risks / Trade-offs

- [账号邮箱常驻侧边栏] → 侧栏开关默认关闭；设置页已显示同一字段；不在本 change 内做脱敏。
- [同厂商卡片不相邻时位置变化] → 归到首次出现处，组内顺序不变；spec 中修改「按网关返回顺序」的表述。
- [`display` 与 `used` 同时存在的普通窗口不再画条] → 此时读数本来就显示 display 文本，进度条与读数不一致才是问题；与设置页一致。

## Migration Plan

纯客户端渲染变化，无设置或数据迁移。回滚：pin 回 0.7.1。
