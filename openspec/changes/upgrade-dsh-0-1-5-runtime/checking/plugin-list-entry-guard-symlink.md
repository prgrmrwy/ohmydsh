# 启动清单在符号链接路径下静默失效(入口守卫缺陷)

## 结论先行

`scripts/plugin-list.mjs` 的**入口守卫**写法脆弱:它拼字符串比较 `import.meta.url`,
而 Node 解析主模块时会**解开符号链接**、`process.argv[1]` 却保留**调用时的路径**。
只要 checkout 是经符号链接访问的,两者就不相等 → **`main()` 根本不执行** →
**退出码 0、零输出、零报错**。

这不是理论问题:devbox 上 `/home/<user>` 就是 `/data00/home/<user>` 的符号链接,
于是 `bin/dsh` 消费该脚本的**两条路径全部静默失效**,启动日志里
**44/44 条**都写成 `plugins=[]`。

**这条缺陷与 `plugin-list-override-blindspot.md` 是同一个面上的两个独立缺陷**:
那个是"报得不全",这个是"根本没报"。两者都**没有任何错误信息**。

---

## 现场

### 症状:启动日志的插件清单恒为空

devbox `$DSH_HOME/dsh-startup.log`,44 条记录**全部** `plugins=[]`:

```
[2026-09-22T01:58:43+0800] dshVersion=0.1.5-rc.2 runtime=customization-host-runtime
  owner=dsh-pet compat=pet-unified-locus-v1 fingerprint=0b97dc62… port=3080 plugins=[]
```

对照**本机(=host)同一文件**:同为该系统、同为 `bin/dsh`,记录是 **23–24** 条 —— 正常。

`bin/dsh` 里两处消费点:

```bash
# print_plugins():启动 msg(失败被吞掉)
out="$(node "$REPO/scripts/plugin-list.mjs" 2>/dev/null || true)"
# record_startup():启动日志里的 plugins=[...](失败同样被吞掉)
plugins="$(node "$REPO/scripts/plugin-list.mjs" --names 2>/dev/null || true)"
```

`2>/dev/null || true` 让**任何**失败都退化成"空清单",没有任何提示 ——
即"这个 profile 一个插件都没加载"与"脚本没跑起来"在观感上**无法区分**。

### 定位:不是 Node 版本,是入口守卫

最初怀疑是 devbox 上 `/usr/bin/node`(v22.16.0)与 nvm 的 v22.23.2 差异。**证伪**:

| 观测(同一 checkout、经符号链接路径) | v22.16.0 | v22.23.2 |
| --- | --- | --- |
| `node scripts/plugin-list.mjs --names` 输出字节数 | **0** | **0** |
| 同一文件 `import` 后直接调 `collectLoadedPlugins(...)` 的行数 | **21** | **21** |

**两个 Node 版本行为完全一致,且模块本身是好的** —— 所以问题在**是否进入 `main()`**。

真正的原因:

```
$PWD                          = /home/zhangyong.617/opensource/ohmydsh      ← 符号链接路径
realpath                      = /data00/home/zhangyong.617/opensource/ohmydsh
```

原写法:

```js
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
```

`import.meta.url` 取的是 **realpath**,`process.argv[1]` 是**调用时路径** →
`file:///data00/…` ≠ `file:///home/…` → 永远为假 → 静默不执行。

### 范围:**只有这一处**,且仓库里已有正确惯用法

全仓扫描 `import.meta.url ===` 只有三处命中:

| 位置 | 写法 |
| --- | --- |
| `scripts/plugin-list.mjs:208` | ❌ `` `file://${process.argv[1]}` `` |
| `packages/worktree-session/src/cli.ts:41` | ✅ `pathToFileURL(realpathSync(argv1)).href` |
| `packages/worktree-session/lib/cli.js:43` | ✅ 同上(构建产物) |

即**仓库自己早就有正确写法**,只有这一处没跟上。

---

## 修复

`scripts/plugin-list.mjs` 改用仓库既有惯用法(比较 realpath),并对 `argv1` 缺失与
`realpathSync` 抛错做保守处理(不是入口调用就静默返回,不引入新噪音):

```js
function isEntryPoint() {
  const argv1 = process.argv[1]
  if (typeof argv1 !== "string" || argv1 === "") return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return false
  }
}
if (isEntryPoint()) main(process.argv.slice(2))
```

---

## 验证

### devbox 真实符号链接路径上的前后对照

| 观测(同为 devbox、同经 `/home/<user>/…` 符号链接路径) | 修复前 | 修复后 |
| --- | --- | --- |
| `--names` 输出字节数 | **0** | **528** |
| 条目数 | **0** | **22** |
| 含 `client-connection` | 否 | **是**(1) |
| 经 realpath 路径调用 | — | **22**(未因修复而退化) |

22 = 21(修复前的真实清单)+ 1(覆盖式接线的 connection 行,见
`plugin-list-override-blindspot.md`)。**两个缺陷叠加才让这一行彻底不可见**。

### 回归测试(带变异检查)

新增 `tests/plugin-list-loaded.test.mjs` 一例:**以子进程方式、经符号链接路径**运行该脚本,
断言输出非空。

> 为什么以前没被抓到:该测试文件里**其它每一例都是 `import` 模块**再调函数,
> 入口守卫**从未被执行过**。这一例是唯一走子进程 + 符号链接的。

**变异检查**(证明它真的能抓到这个 bug):把入口守卫还原成旧的脆弱写法后运行 →
`✖ the CLI entry point still runs when the checkout is reached through a symlink`
(**10 pass / 1 fail**);换回修复版 → **11/11 pass**。

### 全量门禁

| 门 | 结果 |
| --- | --- |
| `node --test tests/plugin-list-loaded.test.mjs` | 11/11 pass |
| `npm test` | **132 pass / 0 fail / 0 skip** |
| `npm run check:artifacts` | tracked paths comply |

---

## 运维含义

1. **这不是 devbox 专属问题,而是"凡经符号链接访问的 checkout"** —— 只要
   `$HOME` 或仓库路径是软链(`/home/x -> /data00/home/x` 这类很常见),功能就静默消失。
   本机(host)路径无软链,所以一直是好的,**这类缺陷只会在特定机器上出现**。
2. **`2>/dev/null || true` 的代价**:它把"清单为空"与"脚本没跑"合并成同一个观感。
   本次是两个独立缺陷叠加才被发现;若只有其中一个,仍会表现为"看起来正常"。
3. 启动日志里的 `plugins=[]` **不能**作为"该 profile 没有 patch 接线插件"的证据。

## 仍未覆盖

- 未在 devbox 上**重启 Host** 以确认启动日志此后真的写入清单(重启会打断并发验收,
  且 `bin/dsh` 消费的是**部署 checkout 上的**脚本副本,需要先合入并更新该 checkout)。
  已证明的是:同一路径、同一 Node 下脚本输出从 0 变为 22 条。
- 其它仓库脚本未做同类审计的**运行期**验证;本次只做了静态扫描(结果:仅此一处命中)。
- Windows 与非 POSIX 路径形态未测。
