# P4 workspace lifecycle portability

## Actual blocker and bounded scope

Lead's native Windows root npm-ci gate reached workspace prepare and failed because the provider-icon package's clean script invoked `rm -rf lib` under cmd without Bash. The same literal clean appeared in eleven workspace manifests. Two directly reachable host builds also used `chmod +x`; collab-kernel's build used mkdir/if/ls/cp. All are within the approved actual command closure, not new plugin functionality.

Only those lifecycle commands were changed after reading every affected manifest. No dependency, version, pin, runtime policy or root lock was changed. Lead owns root metadata synchronization and the native Windows gate rerun.

## RED

`node --test tests/workspace-lifecycle.test.mjs` initially returned exit 1: **0 pass / 4 fail**.

- Manifest lifecycle scan caught POSIX rm clean.
- Isolated package clean expected a single Node inline program but received rm.
- Collab-kernel build retained the POSIX copy pipeline instead of the Node helper.
- Host CLI permission step retained chmod rather than Node builtin behavior.

No missing-file-only failure was used to stand in for these behavioral requirements.

## Smallest fixes

- Eleven `clean` commands invoke Node `fs/promises.rm('lib',{recursive:true,force:true}).catch(error=>{console.error(error);process.exitCode=1})`. The initial synchronous rmSync version passed Linux but was replaced after native Windows evidence below. The deletion path is a fixed literal, not derived from args/env. npm executes a workspace script in its package root; tests execute only fixture-owned package roots and prove source/sibling content survives. Pending filesystem work keeps Node's event loop alive; rejection is nonzero. No real workspace build output was cleaned by this task.
- Worktree-session and dsh-memex host builds retain tsc first, then Node `fs.chmodSync` of their exact CLI file with mode 0755.
- Collab-kernel retains tsc first, then `scripts/copy-convention.mjs`, using builtin filesystem mkdir/readdir/copy. Paths are package-relative via import.meta.url; only immediate regular .md files are copied, no recursive source broadening. Empty convention directories remain valid.

A supplementary literal filename test initially exposed `new URL(entry.name,base)` interpreting # as fragment. The helper now converts stable directory URLs to filesystem paths once and joins literal directory entries with path.join. The same test is GREEN; no assertion was weakened.

## Native Windows follow-up root cause

Launcher-refactor's native Windows Node v24.12.0 control (job bash-265, reported directly) used the same file-based CJS probe under ASCII and Chinese cwd. exists-after results under ASCII: rmSync(file)=false, unlinkSync(file)=false, rmdirSync(empty)=false, rmSync(dir)=false, promises.rm(dir)=false. Under Chinese cwd: rmSync(file)=true and rmSync(dir)=true despite exit 0/empty stderr, while unlinkSync/rmdirSync/promises.rm were false. Relative/absolute and force/no-force controls reproduced the synchronous no-op. The exact eleven clean source programs and actual cwd were separately checked.

Lead authorized the narrow fix to asynchronous builtin rm across all eleven manifests. The existing post-execution exists/content assertions remain unchanged; only the literal-path source check changed from rmSync to .rm. Linux fresh 4/4 remains GREEN. Launcher-refactor refreshed the native candidate and reported job bash-274: native Windows Node v24.12.0 **4/4 passed, zero skip, exit 0**. The same Chinese-path clean fixtures now delete lib, remain idempotent and retain src; copy/permission/no-POSIX tests also pass. This is native lifecycle-test GREEN, not a completed root npm-ci/full manifest gate.

## Fresh GREEN

```sh
node --test tests/workspace-lifecycle.test.mjs
node --check packages/collab-kernel/scripts/copy-convention.mjs
git diff --check
```

Result: **4 passed, 0 failed, 0 skipped, 0 todo**, exit 0; syntax/diff checks passed.

Execution coverage includes all eleven clean programs twice under isolated temporary package roots; empty directory and actual Markdown copying; ignoring non-Markdown files and directories; Unicode/space/# filenames; exact Node chmod programs and POSIX executable bits. Lifecycle structural scan covers every top-level workspace manifest's clean/build/prepare/prepack commands.

This is Linux isolated-fixture evidence, not a successful native Windows full install/build gate. No real npm install, package version bump, root lock edit, production build, deploy or restart was executed here. Lead separately reruns the exact failed native Windows gate with these source changes.
