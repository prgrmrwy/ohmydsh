## 1. 包骨架

- [x] 1.1 创建 `packages/system-clock/`（package.json、cordis.patch.yml、tsconfig.json、tsconfig.client.json、tsdown.config.ts、vitest.config.ts、README.md、CHANGELOG.md、LICENSE）
- [x] 1.2 package.json 声明 `dsh.bundle.patch`、`dsh.client`（platform web + inject 列表）、`exports["./client"]` 与 peer/dev 依赖（cordis、dsh-client-runtime、dsh-client-connection、dsh-client-ui-settings、dsh-client-locale、dsh-client-ui-slots、react/tsdown/tsc/vitest）以及 npm workspaces 关联

## 2. Host 半区：时间采样 RPC

- [x] 2.1 `src/contract.ts`：channel 常量、`now` endpoint 名、采样响应接口（now/timeZone/utcOffsetMinutes/hostname）与 `RpcResult` 形状
- [x] 2.2 `src/host-time.ts`：纯函数解析主机 IANA 时区（空回退 `UTC±HH:MM`）、`utcOffsetMinutes`、hostname
- [x] 2.3 `src/index.ts`：name/inject；`ctx.inject(['connection'])` 内 `connection.rpc.handle('/dsh-system-clock', ..., { authority: 'loopback' })`；`now` 返回当前采样，handler 不 throw，统一返回 RpcResult 成功形状；无 connection 时静默不注册

## 3. Client 半区：时钟引擎与设置章节

- [x] 3.1 `src/client/clock-engine.ts`：纯函数 —— skew 计算、24h 零填充格式化、`Intl timeZone` 渲染、IANA 缺失回退、UTC±HH:MM 标签、日期/星期行、可见性/周期重采样调度（可注入 rpc face）
- [x] 3.2 `src/client/clock-locales.ts`：zh/en 词典（nav / caption / unavailable 等），`ctx.locale.register`
- [x] 3.3 `src/client/section.tsx`：React 章节组件 —— 粗体 HH:MM:SS、日期行、时区行、hostname 小字、不可用降级态；随注入 face 提供 `rpc`
- [x] 3.4 `src/client/index.ts`：inject `['slots','connection','locale']`；注册 `settings.section`（id `system-clock`、order 300、label 跟随语言）；注入 `data-plugin` 样式；清理完整

## 4. 测试

- [x] 4.1 `test/clock-engine.test.ts`：skew/格式化/DST 渲染/回退/标签（jsdom-free 纯函数 + 固定 Intl 桩）
- [x] 4.2 `test/host-time.test.ts`：时区解析 + 偏移计算 + hostname 提取（固定时刻桩）
- [x] 4.3 `test/wiring.test.ts`：注入 rpc face 驱动状态机（成功→ready；失败→unavailable 且计数重试；周期/可见性重采样）

## 5. Manifest 与仓库登记

- [x] 5.1 `dsh.yaml` 增加 `system-clock` local customization 条目（version/brief/note，含 B019 引用）
- [x] 5.2 `BACKLOG.md` 增加 B019 条目（状态：实施中）

## 6. 构建与验证

- [x] 6.1 `npm run typecheck` + `npm run build`（tsdown 产出 lib/client.js、tsc 产出 lib/index.js）通过
- [x] 6.2 `npm test`（vitest 21/21）全部通过
- [x] 6.3 隔离 DSH_HOME 下 `node scripts/sync.mjs` 首次应用变化；连续第二次报 `no changes`（幂等）
- [x] 6.4 仓库级 `npm test`（81/81）与 `npm run check:artifacts` 通过

## 7. 收尾

- [x] 7.1 openspec validate 通过；任务状态与实际进度一致
- [x] 7.2 汇总验收说明（重启 DSH 后 GUI 人工复核点）