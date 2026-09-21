# 启动插件清单对「覆盖式接线」失明(0.1.5 暴露并修复)

## 结论先行

加入 `patches/connection-webserver.yml` 后根测试出现 **1 例失败**。定位结果是
**读取器(`scripts/plugin-list.mjs`)的缺陷,不是 fragment 的问题**:该读取器只认
`patch.insert` 形态,而本 fragment 是本仓库**第一个覆盖式接线**(顶层 `{id, name}`,
按 id 重接线一个已存在的 loader 行)。

已修读取器并补 3 例测试。修完根测试 **131/131 全绿**,且真实部署面上那一行从
「完全隐身」变为可见。

## 现象

```
not ok 73 - every manifest patch fragment this repo ships stays parseable
  location: tests/plugin-list-loaded.test.mjs:138:1
  error: 'shipped patch fragments must contribute loader rows'
  code: 'ERR_ASSERTION'
```

该测试此前的状态是 **skip** —— 它的注释写明「本仓库当前不 ship 任何 patch fragment 时
跳过」。`patches/connection-webserver.yml` 一加入,它就从 skip 转为真正执行并失败。
所以这不是"一直坏的测试",而是**新 fragment 第一次走到了这条不变量的检查面**。

## 根因

`scripts/plugin-list.mjs` 的 `collectLoadedPlugins` 里:

```js
if (patch.insert !== undefined) collectInserted(patch.insert, inserted)
```

只收集 `insert` 形态。而本仓库新加的这个 fragment 是**顶层行**:

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  inject: [webRuntime, webServer]
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
```

它**没有 `insert`** —— 它按行 id 覆盖官方 `connection` 行(整行替换、config 不深合并)。

部署面自证:devbox 的 `$DSH_HOME/profiles/web/cordis.patch.yml` 里
`insert` 出现次数 = **0**,整个文件只有注释和这一条覆盖行。

于是 patch 层对这个读取器**完全隐身** → 产出 0 行 → 断言 `rows.length > 0` 失败。

## 为什么修读取器而不是放松测试

这个读取器存在的**唯一理由**(见其文件头注释)就是防一类缺陷:
「插件靠 patch 层接线,启动 msg 里却长期看不见它」——
`dsh-width-tiers` 曾因此被当成"没装"重复排查过。

覆盖式接线**属于同一类**,而且这一次它是**载荷关键**的:那条覆盖行正是修好所有
Connection RPC channel 注册的那一行(`patches/connection-webserver.yml`,详见
`connection-rpc-devbox.md`)。

真实部署面实测(devbox,**同一个** `$DSH_HOME`,只换读取器):

| 读取器 | 清单行总数 | 命中 `client-connection` |
| --- | --- | --- |
| 原版(`b5be4b0`) | **21** | **0** |
| 修复版 | **22** | **1**(`@deepseek-ai/dsh-client-connection [patch]`) |

也就是说:在修复之前,**修好 Connection RPC 的那一行在启动清单里是完全隐身的**。
将来任何人排查「connection 行为什么是这样接的」都会一无所获 —— 这正是读取器要防的事。

## 修法

`scripts/plugin-list.mjs`:把两种接线形态统一收进一个 `wired` 列表,保持遇到顺序:

1. `insert` 行 → 走原有 `collectInserted`(逻辑不变,含 group 递归);
2. 覆盖式行 → 顶层且 `insert === undefined`、`id` 与 `name` 均为非空字符串、
   且 `disabled !== true` → 记为一行。

既有语义**全部保留**:

- `disabledIds` 仍能把被后续行停用的接线剔除;
- 已由 bundle 层加载的同名包仍不重复出现(`seen` 去重);
- 没有 `name` 的纯 config 覆盖行仍不报(不会把配置行误当成插件)。

## 测试

`tests/plugin-list-loaded.test.mjs` 新增 3 例(并把文件头注释补上"第二种形态"):

- 覆盖式行被报出(`@deepseek-ai/dsh-client-connection`, `source: 'patch'`);
- `disabled: true` 的覆盖行**不**报 —— 它的语义是"丢掉这一行",不贡献任何加载;
- 覆盖行若指向已被 bundle 加载的包,**不重复**。

结果:

```
node --test tests/plugin-list-loaded.test.mjs   →  10/10 pass
npm test                                        →  131 pass, 0 fail, 0 skip
npm run check:artifacts                         →  tracked paths comply
```

## 仍未覆盖

该读取器只解析**结构**,不求值 `!!js` 表达式(这是刻意的:它不应该执行 loader 的表达式)。
因此 `config.trustedHosts: !!js ctx.webRuntime.trustedHosts` 在清单视角下是 `undefined`。
这不影响"哪些插件被加载"的判定,但也意味着**它不能用来校验 config 内容** ——
fence 是否真的接上,只能靠实机行为验证(见 `connection-rpc-devbox.md`)。
