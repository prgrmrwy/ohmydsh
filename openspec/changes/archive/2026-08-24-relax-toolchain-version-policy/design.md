## Context

`5322f11 chore: pin Node and npm toolchain` 为 bootstrap 引入了工具链校验,但采用**字符串精确相等**:`node -v` 必须等于 `24.12.0`、`npm -v` 必须等于 `11.6.2`,否则 `exit 1`。同一份 pin 同时出现在四处——`scripts/bootstrap.sh` 的常量、`package.json` 的 `engines`、`package.json` 的 `packageManager`、`.nvmrc`——彼此没有单一来源。

约束:

- 初始化脚本必须在 macOS / Linux / WSL / Git Bash 通用,不能假定 GNU coreutils(`sort -V` 在 macOS 上行为不同)。
- 校验发生在 `npm ci` **之前**,此时 `node_modules` 可能为空,因此不能依赖 `semver` 等 npm 包做比较。
- `.npmrc` 已开启 `engine-strict=true`,npm 自身会按 `engines` 再校验一次;两套准则必须一致,否则 bootstrap 放行、`npm ci` 却拒绝。
- 依赖可复现性已由根 `package-lock.json` + `npm ci` 保证(见 repo-layout「仓库依赖锁采用根级单一来源」),工具链精确版本不是可复现性的必要条件。

## Goals / Non-Goals

**Goals:**

- 让满足最低版本的任意 Node/npm 都能完成初始化,消除 patch 级版本抖动导致的假失败。
- 把「最低版本」收敛为可核对的少数几处声明,并让 `.nvmrc` 的角色明确为推荐值。
- 保持 fail-closed 的方向不变:低于最低版本仍然拒绝,而不是降级为警告后继续。

**Non-Goals:**

- 不放宽依赖版本本身(lockfile 与 `npm ci` 语义不变)。
- 不引入 semver 库、corepack 或 Volta 等新的工具链管理机制。
- 不改变 `.npmrc` 的 registry 策略与 `engine-strict` 开关。
- 不改动 `dsh.yaml`、sync 物化流程或任何 package 运行时行为。

## Decisions

**1. 最低版本定为 node >= 22.0.0 / npm >= 10.0.0,而非跟随 `.nvmrc`。**

仓库脚本为 ESM + `node --test`,local package 编译目标为 ES2022;Node 22 是覆盖这些能力的最低 LTS 线。选择 LTS 边界而不是「推荐版本减一个 major」,是为了让阈值有稳定的外部依据、不随 `.nvmrc` 漂移。npm 10 是 Node 22 自带的版本,与之配套。
*备选*:阈值直接从 `.nvmrc` 推导(如同 major 即可)。否决——`.nvmrc` 会随日常升级变动,阈值会随之无意收紧,而"能否跑起来"与"推荐用哪个"是两个不同的判断。

**2. 版本比较用自包含的纯 bash `version_lt`,而不是 `sort -V` 或 semver。**

按 `.` 拆分后逐段做十进制数值比较,缺省段补 0,先剥离 `-` 之后的预发布后缀,并用 `10#` 前缀避免 `08`/`09` 被当作八进制。这满足跨平台约束,且在 `npm ci` 之前零依赖。
*备选*:`sort -V`(macOS 的 BSD sort 无 `-V`,需 `gsort`)、`npx semver`(在依赖安装前引入网络与锁竞争,正是 `.npmrc` 注释里记录过的故障模式)。均否决。

**3. `engines` 改为范围并作为准则的书面声明,`packageManager` 删除。**

`engine-strict=true` 下 `engines` 是 npm 自己会执行的那份准则,范围化后与 bootstrap 阈值同义。`packageManager: "npm@11.6.2"` 在 corepack 启用时会**精确锁定** npm 版本,恰好复活我们要移除的行为,且与 `engines` 的范围相互矛盾——删除它比放宽它更清晰。
*备选*:保留 `packageManager` 作为"推荐值"。否决——该字段语义是强制而非推荐,推荐值的位置已经由 `.nvmrc` 承担。

**4. 推荐版本从 `.nvmrc` 读取,保持单一来源。**

bootstrap 读 `.nvmrc`(去掉 `v` 前缀与空白)得到推荐版本,文件缺失时回退到内置默认值,避免脚本因缺文件而中断。这样升级推荐版本只需改 `.nvmrc` 一处。

**5. 提示而非静默。**

版本高于最低值但不等于推荐值时打印一行提示。保留这条信息是为了在排查"本机能跑、他人不能跑"一类问题时,能从初始化输出直接看到实际版本差异。

## Risks / Trade-offs

- **更宽的版本面意味着更少的环境一致性**,某个未来 Node major 可能引入破坏仓库脚本的行为变更 → 缓解:`.nvmrc` 仍给出推荐版本,CI/日常仍在推荐版本上运行;真出现不兼容时提高 `MIN_NODE` 即可,阈值是单向可收紧的。
- **手写版本比较可能有边界疏漏**(前导零、缺省段、预发布后缀) → 缓解:实现时已按这三类构造用例逐一验证;后续若再扩展比较逻辑,应补齐同类用例。
- **`engines` 与 bootstrap 阈值分处两个文件,存在漂移风险** → 缓解:spec 中以「最低版本声明保持单一准则」场景固化二者一致,README 也复述同一组数字;三处不一致即视为规范违背。
- **删除 `packageManager` 后,启用 corepack 的用户不再被自动切到指定 npm** → 影响可接受:`engine-strict` 仍会拒绝低于 `engines` 的 npm,而在最低线之上本就允许自由选择。
