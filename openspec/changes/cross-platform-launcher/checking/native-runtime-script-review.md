# Exact native runtime lifecycle review (2026-10-25)

## Scope and provenance

Five registry tarballs read without installing/running their scripts: @deepseek-ai/dsh-subprocess-local0.2.0-rc.2, @google/genai2.21.0, koffi3.1.1, node-pty1.2.0-beta.15, protobufjs7.6.6. Downloaded tarball bytes matched registry SHA512 integrities. Raw tarballs/metadata/extracted source remain ignored scratch under checking/baselines/native-script-review; no vendoring. This establishes consistency with registry metadata, not publisher authenticity or a full audit of libraries/native binaries/toolchains.

Current repository policy has only genai1.52.0=false and protobufjs7.6.6=false. No new execution grant has been applied. Real builder/Host is not rerun after D8 repair until human decision.

## Actual registry lifecycle behavior

| Exact dependency | Observed script | Proposed policy / consequence |
|---|---|---|
| @google/genai@2.21.0 | preinstall literal echo no-op; prepare declared but scripts/prepare.js not shipped | false. Registry dependency prepare is not an install lifecycle requirement; no library changes. Old1.52.0 false does not cover this version. |
| protobufjs@7.6.6 |32-line postinstall reads own/adjacent package JSON, optional stderr version warning | retain false; no build output required. |
| @deepseek-ai/dsh-subprocess-local@0.2.0-rc.2 |16-line ensure-spawn-helper.mjs resolves node-pty, chmod755 on existing current-platform prebuilt/build spawn-helper | request exact true; on Windows normally no matching helper, on POSIX restores helper execute bit. No network/child command in this script. |
| koffi@3.1.1 | cnoke.cjs --prebuild --release first spawns current Node to require package/load native module; if unavailable can call CMake/compiler and write/clean package build paths | request exact true, if user accepts native load/build fallback. Packaged runtime loads @koromix platform optional prebuild; fallback depends on external build tools. Not merely a no-op and not a reviewed native-binary guarantee. |
| node-pty@1.2.0-beta.15 | prebuild.js checks current-platform directory; install falls back to node-gyp rebuild; post-install.js cleans package build/Release except known outputs and copies bundled conpty.dll/OpenConsole.exe for Windows x64/arm64 | request exact true. Actual win32-x64 .node prebuilds shipped. Fallback may invoke compiler/download Node build inputs through node-gyp; package-local writes/deletes and environment arch/build-from-source influence. No promise this approval restricts execution to prebuilt-only path. |

A true exact rule approves that package's registry install lifecycle, not just one platform branch. Cannot approve only one script via this npm policy. User must accept the complete described lifecycle/fallback for that exact version, or keep denied and test an alternative with explicit scope. No automatic toolchain installation, audit-fix, dependency upgrade or allow-all.

## Proposed next authorization

Add genai2.21.0=false; retain earlier exact false rules. Add true ONLY for subprocess-local0.2.0-rc.2, koffi3.1.1, node-pty1.2.0-beta.15 IF separately approved. Then run native builder once on ordinary Windows candidate, fail on any newly resolved script version; investigate known residual pointers read-only before execution and request recovery if needed. Real Host test uses a verified unused non3080 port, no browser open, cleanup only verified owned test PID. No existing Host restart or Mac connection.

Alternative: keep all scripts denied, stop at current inert verification evidence and report Windows Host acceptance incomplete. No permission is inferred from prior blanket builder runs.

## User decision

User explicitly selected approval of the three exact versions after the fallback/side-effect disclosure above. Source policy now contains exact true for subprocess-local0.2.0-rc.2/koffi3.1.1/node-pty1.2.0-beta.15 and exact false for genai1.52.0/genai2.21.0/protobufjs7.6.6. No other execution permission. This later human decision supersedes earlier 'no new true yet' notes only from this point forward, not retroactively. Next real native attempt must retain strict unknown rejection and inspect interrupted pointer state first.
