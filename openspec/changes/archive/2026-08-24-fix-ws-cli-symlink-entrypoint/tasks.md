## 1. Reproduce and lock in the failure

- [x] 1.1 Add a regression test in `packages/worktree-session/test/` that resolves the built `lib/cli.js`, creates a symlink to it in a temp dir, spawns that symlink with `status <worktree-path>` as a child process, and asserts exit code 0 plus parseable JSON on stdout carrying the expected `operationId`
- [x] 1.2 Extend that test with a `clean --dry-run` case through the same symlink, asserting `dryRun: true` and the presence of planned actions, proving the safety gates actually ran
- [x] 1.3 Add a case asserting that importing the CLI module produces no stdout and executes no subcommand
- [x] 1.4 Make the test skip with an explicit message (never silently pass) when the built artifact is absent
- [x] 1.5 Run the new test against the unfixed implementation and confirm the symlink cases FAIL; record the observed failure

## 2. Fix the entrypoint guard

- [x] 2.1 Replace the `import.meta.url === pathToFileURL(process.argv[1]).href` guard in `packages/worktree-session/src/cli.ts` with `import.meta.main`, guarded by `typeof import.meta.main === 'boolean'`
- [x] 2.2 Add the realpath-comparison fallback for runtimes where `import.meta.main` is unavailable, wrapped so a missing or unresolvable `process.argv[1]` cannot throw
- [x] 2.3 Confirm the `Usage:` path for an unknown subcommand still exits non-zero with a stderr diagnostic, so no path pairs "checks not executed" with exit code 0
- [x] 2.4 Keep `main` exported and side-effect-free on import

## 3. Verify the fix

- [x] 3.1 Rebuild the package and confirm the tests from group 1 now pass
- [x] 3.2 Verify all four invocation paths emit correct JSON: `bin` symlink, built-artifact realpath, relative path, and `skills/ws/scripts/ws.sh`
- [x] 3.3 Run the package's own test suite, plus repo `npm test` and `npm run check:artifacts`
- [x] 3.4 Confirm no build output under `lib/` was committed (per repo artifact rules)

## 4. Materialize and confirm deployment

- [x] 4.1 Run `node scripts/sync.mjs` and verify a second consecutive run produces no changes (idempotence)
- [x] 4.2 Verify the deployed profile binary (`~/.dsh/profiles/web/node_modules/.bin/dsh-ws`) executes `status` and emits JSON instead of exiting 0 silently
- [x] 4.3 之前的 clean --dry-run 结果均来自 realpath 路径（ws.sh fallback/node 直接执行），从未经过损坏的 bin 入口；回归测试 1.2 已通过 bin symlink 路径验证 dry-run 真实评估 safety gates Re-run any `clean --dry-run` results previously obtained through the `bin` entrypoint, since those never actually evaluated the safety gates

## 5. Close out

- [x] 5.1 Confirm the delta requirement in `specs/source-workspace-worktree-session/spec.md` matches final behavior
- [x] 5.2 Run `openspec validate --strict` for this change
- [ ] 5.3 Archive the change once implementation and verification are complete