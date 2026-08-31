## 1. sync.mjs:共享真值/假值 helper

- [x] 1.1 在 `scripts/sync.mjs` 新增 `resolveEnabledOverride(raw)`:复用现有 `LAN_TRUE`/`LAN_FALSE` 词表,`raw` trim 后为空/未定义返回 `undefined`;命中真值集合返回 `true`;命中假值集合返回 `false`;其余返回 `undefined`(不识别 → 调用方回退)
- [x] 1.2 `resolveWebLan(manifest)` 改为调用 `resolveEnabledOverride(process.env.DSH_LAN)`,未定义时回退 `manifest.web.lan`;确认既有 `tests/sync-web-lan.test.mjs` 全部用例无需改动即通过(纯重构,行为不变)

## 2. manifest 校验与折算:`enabledEnv`

- [x] 2.1 在 `loadManifest()` 的 customization 逐项校验块(`doc.customizations.map(...)`)中新增:`item.enabledEnv !== undefined` 时,必须是字符串且匹配 `^DSH_[A-Z0-9_]+$`,否则 `throw new Error` 报出具体 `label`/`id`/非法取值
- [x] 2.2 同一处计算有效 `enabled`:声明了合法 `enabledEnv` 时,先取 `resolveEnabledOverride(process.env[item.enabledEnv])`;结果为 `true`/`false` 时直接作为有效 `enabled`;为 `undefined` 时回退到既有 `item.enabled !== false`
- [x] 2.3 确认返回对象仍是 `{ ...item, source, enabled, buildInputs, compatDependencies }` 的形状(`enabledEnv` 原样保留在展开的 `...item` 中,不需要单独处理),下游 `syncPackages`/`syncDirs`/`syncPatches` 零改动

## 3. manifest 与文档

- [x] 3.1 `dsh.yaml`:`dsh-traex-bridge` 条目 `enabled: true` 改为 `enabled: false`,新增 `enabledEnv: DSH_TRAEX_BRIDGE`;在条目上方注释补一句说明("默认关闭,机器专属通过 env 打开,不改本文件")
- [x] 3.2 `dsh.yaml` 顶部字段约定注释块补充 `enabledEnv` 的存在与用途(仿照现有 `brief`/`note`/`name` 字段约定行的写法)
- [x] 3.3 `.env.local.example` 新增一条注释示例(仿照现有 `DSH_LAN`/`SSH_CONNECTION` 条目的风格),说明 `DSH_TRAEX_BRIDGE=1` 的作用与安全提示(内部包,凭据/流量走内网)
- [x] 3.4 `README.md`:在「第三方定制(remote)约定」或「日常命令」附近补一小段,说明 manifest 定制项可选 `enabledEnv` 字段的通用用法,与 `web.lan`/`DSH_LAN` 段落呼应并互相提及

## 4. 测试

- [x] 4.1 新增 `tests/sync-customization-enabled-env.test.mjs`:fixture 参照 `tests/sync-web-lan.test.mjs`/`tests/sync-agent-instructions.test.mjs` 的搭建方式(临时目录 + 复制 `scripts/sync.mjs`/`scripts/lib/dsh-cli.mjs` + symlink node_modules + 假 `DSH_BIN`),customizations 用一个简单的 `type: skill`(仓库内置一个最小 `skills/<id>/SKILL.md` 测试夹具)或 `type: patch` 定制项即可覆盖启用/禁用物化痕迹,不需要真实网络安装(实现选用 `type: patch`,以生成的 `cordis.patch.yml` fragment 标记作为物化痕迹的判定点)
- [x] 4.2 用例:`enabled: false` + `enabledEnv: DSH_X`,环境变量真值(`1`)→ 该定制被物化(如 skill 目录被拷贝到 `$DSH_HOME/skills/<id>`)
- [x] 4.3 用例:`enabled: true` + `enabledEnv: DSH_X`,环境变量假值(`0`)→ 该定制未被物化/已被移除
- [x] 4.4 用例:声明了 `enabledEnv` 但环境变量未设置 → 回退到 manifest `enabled` 字段,两种取值(true/false)各验证一次
- [x] 4.5 用例:`enabledEnv` 取值不匹配 `^DSH_[A-Z0-9_]+$`(如小写、缺前缀)→ sync 非零退出,stderr 包含该字段名或取值,且不产生任何物化副作用(部署目录内容与运行前一致)
- [x] 4.6 用例:连续两次运行(环境变量取值不变)→ 第二次报 no changes(幂等)
- [x] 4.7 用例:未声明 `enabledEnv` 的定制,设置一个同名/无关环境变量不影响其启用状态(证明隔离性——只有显式声明的定制才读取环境)

## 5. 本机验证与回归

- [x] 5.1 本机(当前开发机)`.env.local` 追加 `DSH_TRAEX_BRIDGE=1`(不提交)
- [x] 5.2 `dsh build`(即 `node scripts/sync.mjs`,经仓库 registry 注入路径):确认 `dsh-traex-bridge` 仍在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中,`cordis.patch.yml` 仍含 `llm-traex-bridge` 片段;连续第二次运行报 no changes(验证:`dsh.profile.bundles` 含 `@byted/dsh-traex-bridge`,其自带 `cordis.patch.yml` 的 `llm-traex-bridge` insert 完好,`dsh build` 报 `no changes`)
- [x] 5.3 临时注释掉本机 `.env.local` 的 `DSH_TRAEX_BRIDGE=1`(或设为 `0`)后 `dsh build`,确认插件被移除出 bundles 且 patch 片段消失;随后恢复 `DSH_TRAEX_BRIDGE=1` 并再次 `dsh build` 确认插件重新出现(验证 D4 的可逆性,而不是留在移除状态)(验证:`DSH_TRAEX_BRIDGE=0` 后 bundles/dependencies/`node_modules/@byted` 均清除;恢复 `=1` 后重装成功,`dsh.profile.bundles`/自带 patch 片段恢复,后续运行 no changes;安装需仓库 registry 之外显式 `npm_config_registry=http://bnpm.byted.org`,与 manifest note 记录的既有前置条件一致,非本变更引入)
- [x] 5.4 运行 `npm test`(全量回归,含新增用例)(80/80 通过,含新增 8 个 `enabledEnv` 用例)
- [x] 5.5 运行 `npm run check:artifacts`(通过)
- [x] 5.6 运行 `node scripts/sync.mjs` 两次确认整体幂等(非仅新增用例范围)(第二次报 `no changes`)

## 6. 收尾

- [x] 6.1 若实现过程中发现 spec 与实现不一致,先更新 `openspec/changes/customization-env-gate/specs/` 再改代码(核对:实现与全部 5 条 Scenario 完全一致,无需修改 delta spec)
- [x] 6.2 运行 `openspec validate customization-env-gate --strict`(通过)
- [x] 6.3 归档 change(`openspec archive customization-env-gate`),确认 `openspec/specs/repo-layout/spec.md` 已反映最终行为(已合入「定制项可声明环境变量覆盖有效启用状态」Requirement,`openspec validate --all --strict` 8/8 通过)
- [x] 6.4 提交并推送到远端(`git push`),确认远端分支/PR 状态符合仓库既有提交约定
