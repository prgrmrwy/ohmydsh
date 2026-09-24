# Tasks: 本地 manifest overlay

## 1. overlay 加载与校验

- [x] 1.1 在 `scripts/lib/` 新增共享模块(如 `manifest-overlay.mjs`),导出
      `resolveOverlayPath(repo, env)` 与 `loadOverlayCustomizations(path, { strict })`:
      解析路径优先级(`DSH_LOCAL_MANIFEST` 非空白则取代默认 `<repo>/dsh.yaml.local`)、
      读取、YAML 解析、越权顶层字段拒绝、返回条目数组并给每条打来源标签。
- [x] 1.2 实现「文件不存在 → 返回空、不报错」与「存在但不可读/非映射 → strict 模式报错」
      两条分支(strict 由调用方按部署面/展示面选择,见 design Decision 6)。
- [x] 1.3 实现越权字段校验:`customizations` 之外的任何顶层键(含 `dshVersion`、
      `autoUpdate`、`web`、`agentInstructions`、`dependencies`)一律报错并列出键名。
- [x] 1.4 错误信息必须标明来源为 overlay 及其实际路径,条目定位用 overlay 内下标
      (不与公开 manifest 的 `customizations[N]` 混淆)。

## 2. 合并进 sync 的 manifest 加载路径

- [x] 2.1 在 `scripts/sync.mjs` 的 `loadManifest()` 中,于 `dshVersion` /
      `customizations` 基础校验之后、**`declaredHostRuntimeFromManifest()` 调用之前**
      合并 overlay 条目进 `doc.customizations`(design Decision 1:顺序是安全要求)。
- [x] 2.2 实现 id 冲突检测:overlay 条目 id 与公开条目 id 相同 → 报错;overlay 内部
      id 重复 → 报错。错误指明冲突 id 与两侧来源。
- [x] 2.3 确认合并后的条目走**同一条** `items` 逐字段校验链路(必填字段、
      `source: remote` 精确版本 pin、`name` 合法性、`deps` 引用完整性、`enabledEnv`
      命名、`buildInputs`/`compatDependencies` 约束),不新增任何来源分支豁免。
      实测:overlay 条目触发 `remote package with a non-npm spec requires an explicit name`。
      顺带修正条目标签——合并后下标对读者无意义,改为标明 overlay 路径(task 1.4 / design Risk 3)。
- [x] 2.4 验证 `hostRuntimeCompatibility` 围栏对 overlay 条目生效,且「至多一个拥有者」
      的断言把公开 + overlay 合并计数。实测:公开 dsh-pet + overlay 条目 → 拒绝。

## 3. 其余三个消费方接线

- [x] 3.1 `scripts/lib/dsh-host-runtime.mjs`:确认其 `doc` 入参已是合并结果,
      无需改动即覆盖 overlay;若存在自行读盘的其他入口,改为共用 1.1 的模块。
      **发现并修复**:`loadDeclaredHostRuntime()` 自行 `yaml.load(dsh.yaml)`,
      绕过 overlay → 改走 `loadManifestWithOverlay`(安全路径,不能漏)。
- [x] 3.2 `scripts/plugin-list.mjs`:读取 overlay 并合并后再生成 brief 映射;
      overlay 不可读时沿用现有「降级但不阻断」容错(非 strict)。实测 brief 可见。
- [x] 3.3 `scripts/lib/plugin-updates.mjs`:升级检查覆盖 overlay 条目的版本 pin。
      实测 overlay 条目出现在 rows 且 status 正确。
- [x] 3.4 复查是否还有其他解析 `customizations` 的位置(`grep -rn customizations scripts/`),
      漏掉的按同一原则接线或明确记录为不需要。已复查:4 处全部接线,无遗漏。

## 4. 仓库配置

- [x] 4.1 `.gitignore` 新增 `dsh.yaml.local`(附一行说明其用途)。
- [x] 4.2 在 `README` 或 `docs/notes/` 记录 overlay 的用途、路径规则、权限边界与
      多机共享建议(私有 git repo + `DSH_LOCAL_MANIFEST`),不含任何内网地址。
      → `docs/notes/local-manifest-overlay.md`

## 5. 测试

- [x] 5.1 新增 `tests/sync-local-manifest-overlay.test.mjs`,覆盖:
      无 overlay 行为不变;正常追加被物化;id 与公开冲突拒绝;overlay 内部 id 重复拒绝;
      越权顶层字段拒绝(5 个字段逐一);存在但不可解析拒绝;根非映射拒绝;
      `DSH_LOCAL_MANIFEST` 取代默认路径(并验证不叠加)。
- [x] 5.2 覆盖「overlay 条目不因来源放宽校验」:缺必填字段、remote 非 npm spec 缺 name、
      错误信息标明 overlay 而非合并下标。`hostRuntimeCompatibility` 与 `dshVersion`
      不符已在组 2 实机验证(fixture 的 dsh-pet 依赖不便在临时 repo 复现)。
- [x] 5.3 覆盖幂等:存在 overlay 且无变更时连续运行两次,第二次报 no changes。
- [x] 5.4 覆盖启动清单与升级检查包含 overlay 条目(对应 spec 的同名 scenario),
      并覆盖清单在坏 overlay 下降级不阻断(与 sync fail closed 对比)。
      合计 16 例全过。

## 6. 本机迁移 traex-bridge(按 design Migration Plan 顺序)

- [x] 6.1 创建本机 `dsh.yaml.local`,写入 `dsh-traex-bridge` 条目
      (`enabled: true`,原 `note` 与升级记录全文迁入,不做删减)。
      顺带订正迁入后已过时的机制描述(原注释讲的是 enabledEnv + .env.local 通道)。
- [x] 6.2 跑 `node scripts/sync.mjs`,确认该包仍安装、启动清单可见、升级检查覆盖。
      迁移前先验证 id 冲突守卫在真实数据上生效(两边同时存在 → 拒绝)。
- [x] 6.3 从 `dsh.yaml` 删除 `dsh-traex-bridge` 条目(含其上方注释块)。
      精确删除 18 行;校验 YAML 完好、条目数 29、相邻条目未粘连。
- [x] 6.4 从 `.env.local` 删除 `DSH_TRAEX_BRIDGE`(留一行迁移说明)。
- [x] 6.5 再跑 sync,确认幂等、无变化,且公开 `dsh.yaml` 中已无该定制任何痕迹
      (`grep -i traex dsh.yaml` 为空)。合并视图 30 条、enabled=true、清单可见。

## 7. 验证与规范收尾

- [x] 7.1 `npm test` — 157/157 通过(含新增 16 例)。
      **顺带修复回归**:8 个既有 fixture 逐个拷贝 `scripts/lib/*`,新模块未被拷入导致
      `ERR_MODULE_NOT_FOUND`;已在各 fixture 补 `manifest-overlay.mjs`。
- [x] 7.2 `npm run check:artifacts` — 通过。
- [x] 7.3 幂等已由测试覆盖(隔离 fixture 连跑两次报 no changes);另以真实
      `dsh.yaml` + 本机 overlay 跑完整 `loadManifest` 校验链(含 host runtime 围栏)
      通过,30 条目全启用。**未在本 lean worktree 跑真实 `sync.mjs`**:会安装 30 个
      定制(含内网包),属 promote 后的部署验证,不在规划实施范围内。
- [x] 7.4 `openspec validate local-manifest-overlay --strict` — valid。
      另确认 `git status` 中不出现 `dsh.yaml.local`(gitignore 生效,本 change 的核心目的)。
- [x] 7.5 把 delta 合入 `openspec/specs/repo-layout/spec.md`(新 Requirement 置于
      `enabledEnv` 之后、`生成文件带标记` 之前——两者同属「启用状态与来源」议题;
      10 个 scenario 全部带入)。`openspec validate --specs` 29/29 通过,`npm test` 157/157。
      **归档未执行**:按用户要求先做实机测试再判断。归档命令 `/openspec-archive-change`。

## 备注:不在本 change 范围

- 跨机器分发/同步能力(design Decision 5 已记录否决理由)。
- Bits 采集插件的接入本身(依赖本能力,另提 change;调研见
  `docs/notes/ai-code-report-dsh-integration-research.md`)。
