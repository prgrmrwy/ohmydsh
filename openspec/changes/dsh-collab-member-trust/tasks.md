## 1. 协作约定 v2（collab-kernel）

- [x] 1.1 新增 `src/convention/v2.md`：v1 全文加一节"成员信任"（宿主声明时代为加入、承接 request 在原有权限内直接执行、不另向人类索取授权；未声明时按 v1），并调整第 7 条措辞；`v1.md` 字节不变
- [x] 1.2 `src/convention/index.ts` 改为版本表 `{1, 2}`，`defaultConvention` 指向 v2，`readConvention` 按版本表查找
- [x] 1.3 `service/index.ts` 的 `readConvention` 改为查版本表（未显式传入 `convention` 时），使 v1 空间仍能读取 v1
- [x] 1.4 测试：v1 sha256 等于 `5df2524d42641e3885f4e2ec0314d4b03f0922662d933f9283fe1ddd4c8cd039`；新空间记录 v2；v1 空间 `readConvention('1')` 成功；`'9'` 返回 `COLLAB_CONVENTION_UNKNOWN`；更新受影响的既有 convention 用例

## 2. 配置（dsh-collab）

- [x] 2.1 `config.ts`：`HostConfig`/`AdmissionPolicy` 增加 `memberTrust`，键白名单加入，非布尔 `COLLAB_BAD_CONFIG`，缺省 `true`
- [x] 2.2 `index.ts` 的 `Config` schema 增加 `memberTrust: z.boolean().default(true)`，并把策略传给 provider 与工具
- [x] 2.3 测试：缺省为 true、`'yes'` 拒绝启动且不注册工具不建 dataDir

## 3. 邀请即加入

- [x] 3.1 `tools.ts`：`collab_invite` 在 `memberTrust` 时于 invite 成功后以被邀请地址的 agent principal、cmdId `dsh-collab:auto-join` 调用 `join`，返回追加 `autoJoined`；join 抛错返回 `false`；`memberTrust: false` 时返回不变
- [x] 3.2 测试：invite 后 B 可读、`collab_status` 中位于 `spaces`；重试 invite 不新增事件且 `autoJoined` 仍为 true；B 先 decline 时 `autoJoined:false`；allowlist 名单外不认领也不尝试加入；`memberTrust:false` 保持 invited

## 4. 唤醒文本

- [x] 4.1 `session-provider.ts`：按 `memberTrust` 取两套固定文本；`true` 时含"原有权限边界""无需再向用户确认""人类决定只能来自受信确认"，邀请指针追加"宿主已代为加入，若仍列出邀请再自行 join"；`false` 时逐字保留旧文本
- [x] 4.2 测试：两种配置下的文本断言，`true` 时不含"不是额外授权""不表示用户同意"

## 5. 打包与部署

- [x] 5.1 `tsdown.config.ts` 的 `build:done` 同时复制 `v2.md`；更新 `build-artifact.test.mjs`、`sync-artifact.test.mjs` 的必需文件与内容断言
- [x] 5.2 更新 `dsh.yaml` 中 dsh-collab 的 note（说明 `memberTrust` 默认开启及收紧方式）与 package README（中英）配置说明

## 6. 验证

- [x] 6.1 `npm --workspace packages/collab-kernel test`、`npm --workspace packages/dsh-collab test` 及各自 typecheck/build
- [ ] 6.2 仓库级 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs` 连续两次幂等
- [x] 6.3 `openspec validate dsh-collab-member-trust --strict`
- [ ] 6.4 真实 Host 验收：`dsh build` + `dsh restart` 后，A 邀请 B 时 B 无需 join；A 给 B 派 request 后，B 不问人直接 accepted→done（权限内任务）
