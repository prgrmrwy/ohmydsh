# Real terminal-close acceptance

## Implemented test

`tests/platform/launcher-terminal.test.mjs` registers `test_host_survives_real_terminal_close` normally. `tests/helpers/terminal-fixture.mjs` creates only an isolated synthetic package/runtime, DSH home and random loopback port. It executes the current real `bin/dsh.mjs`; maintenance subprocesses are inert and runtime is a Node listener with the exact synthetic DSH package identity. There is no production Host, default 3080 port, user config or existing terminal interaction.

## POSIX mechanism

Python's standard-library pty.fork creates a new shell session with its own controlling slave terminal. The shell invokes the real Node launcher, records its returned zero status, and remains blocked in read. Only after receiving the launcher-returned marker does the Python parent close the PTY master. That is the actual terminal hangup event, not killing a parent process tree. A shell HUP trap writes a fixture-owned sentinel and exits. Python waits for that shell to exit.

The Node test requires all of:

1. launcher returned zero before terminal close;
2. PTY was closed and controlling shell exited;
3. shell HUP sentinel exists, proving terminal-close delivered SIGHUP;
4. the original fixture Host remains positively owned and listening after closure;
5. the same PID remains owned on a subsequent probe.

Cleanup first proves argv's exact entry equals the created fixture bin, then delegates to the product's safe stop. Unknown port owners are never killed; failed cleanup is an error instead of a best-effort support claim. No recursive taskkill is present.

## Linux actual result

```sh
node --test tests/platform/launcher-terminal.test.mjs
node --check tests/helpers/terminal-fixture.mjs
git diff --check
```

Fresh result: **1 passed, 0 failed, 0 skipped, 0 todo**, exit 0. The test ran on Linux with Python3, lsof and current Node. Terminal close was real PTY master closure and the shell HUP assertion passed. Syntax and diff checks passed.

## Explicit remaining RED platforms

Native Windows independent-console-close automation remains **actual RED**, not an unimplemented skip. A native Node v24.12.0 run invoked this module directly through the worktree UNC path; the fixture itself was copied into local Windows TEMP with only public dependencies and a sanitized system environment. The native test creates a new PowerShell process, detaches it from inherited console and allocates a new visible console via builtin C# P/Invoke. It records that self-owned HWND and registers a handler that must write event code 2 (CTRL_CLOSE_EVENT). After the real launcher returns zero and the fixture Host is positively owned, a separate helper posts WM_CLOSE only to that recorded visible HWND. No current/user terminal is addressed.

Initial native attempt failed before launch because PowerShell's native invocation retained invalid console handles after AllocConsole. Switching the trusted helper to C# ProcessStartInfo allowed the real launcher to return. Final native attempt (job bash-267) reached the close attempt but failed after a bounded wait: `Console shell did not close`. No CTRL_CLOSE_EVENT success is claimed. Cleanup terminated only its exact new PowerShell child (not a tree) after failed console close and stopped only the positively identified synthetic Host through stopServer. There is no taskkill /T parent-tree simulation.

Exact native invocation was `powershell.exe -NoProfile -NonInteractive -Command '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); & "C:\nvm4w\nodejs\node.exe" "\\wsl.localhost\Ubuntu-24.04\home\prgrmr\opensource\ohmydsh\.worktrees\win\tests\platform\launcher-terminal.test.mjs"; exit $LASTEXITCODE'`. It returned exit 1; one registered test failed, zero skipped/todo. Native `node --test` did not resolve this UNC filename, so direct Node module execution was used; test registration/results were still node:test, not a synthetic status.

The POSIX test is portable to macOS but has not been run on macOS in this task; its platform evidence remains missing, not GREEN. Python3 is an existing system test prerequisite, not a new project/runtime dependency. This file records a **Linux-only acceptance result**, not completion of the required three-platform terminal gate or full manifest support.
