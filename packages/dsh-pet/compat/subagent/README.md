# Pet Locus pinned-source compatibility runtime

English · [简体中文](README.zh.md)

## What this is

The current `dsh.yaml` pins DSH `0.2.0-rc.2`. The Pet unified locus needs host
capabilities that the official package has not released yet, so this directory
maintains a minimal patch against the pinned tag.

**Re-derived on 2026-10-04 against `dsh-v0.2.0-rc.2` (`639ed015`)** (change `upgrade-dsh-0-2-0-runtime` W5):
the four seams still have 0 hits in a clean HEAD (checked with `git grep`), so all are kept; after a
three-way merge the source hunk in `child-agent.ts` is semantically the same as on 0.1.5 (0.2.0's
`agentPresets.mount` still returns `{ id }`); the hunk for `list-children.spec.ts` is void, because upstream
deleted the case it modified. Upstream subagent suite: 316 pass unpatched, 327 pass patched (the extra 11
are the seam cases).

**The current overlay replaces exactly one upstream package: `@deepseek-ai/dsh-subagent`.**

The seams it carries (matching 5 capability markers):

- `settlementNotice: 'silent'` — suppresses the automatic delivery of a child's settlement to the parent
  session. When the parent is not idle the official path is `steer`, which injects at the nearest step
  boundary of the parent's running turn; but a locus child's result has already been reported to the real
  audience through Lark, and the parent is not that audience. The only official suppression switch,
  `announced`, means "this child never really existed", which does not fit. Reported upstream: discussions
  #7508 (cross-referencing #5360).
- `createIdleContinuable` — creates a durable child without submitting its first prompt. The official
  `SubagentStartRequest.prompt` is required, whereas locus creation is two-phase (create the child → create
  the group → commit the locus row → only then deliver the first real Delivery); in between, the child must
  exist but must not start working.
- `contextMode: 'independent-v1'` + a durable `toolFilter` — the child mounts a composition independently
  from **its own persisted preset** and verifies that what it mounted is the one recorded in the header
  (throwing on a mismatch). The official `composeFrom` binds the **parent's** standing mount instance, which
  guarantees "an already-live child is not polluted by the parent's later changes", while cold recovery needs
  "a child can rebuild its own composition independently of the parent". Callers can name that preset
  explicitly with `agentPreset` (marker `supportsIndependentChildAgentPreset`); both cold-recovery paths read
  it back from the descriptor and mount it, and a missing one is `NOT_RESUMABLE`. Pet always passes
  `dsh-pet-executor`, so the tool surface of a locus child does not depend on which preset the main session
  runs — `standard`'s `tool-subagent` carries `modelSelectionSettings: true`, which registers into the
  child's own layer per agent, and `toolFilter` only filters the inherited layer and cannot remove it.
  Without this, you either refuse `/bind` to a user's ordinary session, or produce a child that can delegate
  `bash`/`lark-cli`.
- `withLiveContinuableChildSession` — reaches the exact child Session inside the continuation owner. The
  official generic Session routing **deliberately** does not resolve a continuation-owned child.

### Removed seams (do not add them back)

- **Atomic storage batch / exclusive SQLite** (formerly replaced the four packages `storage`,
  `storage-domain`, `storage-json` and `storage-sqlite`): `@deepseek-ai/dsh-storage` publicly exports
  `StorageBackend` / `KvFacet` / `KvUnit` and `BackendRegistry`, and states that routing belongs to the
  consumer, so Pet now **registers its own backend** (`src/host/storage/`) with zero upstream changes.
- **`isolateQueuedTurnClaim`** (formerly replaced `core/agent` and `core/agent-loop`): it served only the
  push-style inquiry dispatch of B035, and that path has been replaced by pull-style context tools; the
  override was never enabled and the ledger has 0 rows.

Reintroducing either needs a fresh, direct justification under `pet-compat-minimization`; it is not a revert.

This directory keeps the pinned upstream tag, a reviewable patch/hash and rebuild scripts. The generated
`.upstream/`, `lib/` and `.launcher/` are not deployment truth and do not enter Git.

`.upstream/` is a build cache (about 2.3 GB; rebuilding needs the network). Its reuse rule is decided by
`upstream-cache.cjs`: after each **successful** build, the upstream commit and the patch hash are recorded in
`.upstream/.git/dsh-compat-cache.json`; the next build reuses the ignored build products (`node_modules`,
`lib/`) only if both are unchanged — otherwise (or when there is no record, or the build was interrupted) it
first deletes every untracked and ignored file with `git clean -ffdx` and then builds. So upgrading the DSH
version or changing the patch **does not need a manual cache wipe**. The incident that happened: a cache from
the 0.1.5 era was reused as-is during the 0.2 upgrade, the `lib/` left by a package that 0.2 had deleted was
bundled into the host build, and `MISSING_EXPORT: SettingsProvider` stopped DSH from starting (2026-10-08, VM).

## Declarative selection and scope

The local `dsh-pet` customization in `dsh.yaml` declares:

```yaml
hostRuntimeCompatibility:
  kind: pet-unified-locus-v1
  supportedDshVersion: 0.2.0-rc.2
```

The declaration says "Pet requests a Host-level compatibility runtime"; the technical effect is that the whole
long-running `dsh web` Host uses an isolated DSH dependency root. It is not a local replacement that only
affects the inside of the Pet plugin.

Only `scripts/dsh-server-bin.mjs` resolves this declaration. One-shot commands such as `dsh build`, sync,
plugin and `--dump-config` still use the official exact CLI named by `dshVersion` when there is no explicit
human-set `DSH_BIN`; they neither build nor load this overlay. `DSH_BIN` remains a cross-command emergency
escape hatch and is no longer Pet's normal persistent configuration.

If an old machine's `.env.local` still contains the historical Pet launcher path of the current checkout,
`bin/dsh` recognizes the exact value newly injected by that file, prints a migration warning and ignores it;
when the caller explicitly sets the same path in the shell, that still takes precedence, and any other path is
never guessed at or deleted.

## Build and safety boundary

First Host preparation runs `build-launcher.cjs`; when the fingerprint hits, it does only a lightweight
self-check — no clone, build, install or registry access. The fingerprint covers:

- the pinned DSH version and the checkout canonical path;
- the patch and its pinned SHA;
- the Subagent/launcher/lock/timeout builders;
- the package template.

A rebuild uses one cross-process shared lock that can recover from a stale owner, covering the whole chain of
Subagent source and launcher, and pins `npm@11.19.0` (launcher) and the upstream-declared `pnpm@11.7.0`
(source build) to eliminate drift of machine-global package managers. The source checkout sets `CI=true` only
in the install subprocess to skip the unrelated development-repo Lefthook installation, while its own install
scripts still run; the tsc/tsdown build does not inherit that environment. The reviewed DSH source requires
Node `^22.19.0 || >=24.0.0`; an older Node fails clearly before clone/install. All external git/corepack/npm
subprocesses run through a bounded supervisor, and a timeout kills the process group. The launcher completes
in a same-filesystem sibling staging directory:

1. build the pinned tag and verify the patch capability markers;
2. install the official `@deepseek-ai/dsh@0.2.0-rc.2`, one reviewed override (subagent) and the explicitly
   declared framework versions (cordis / cordis-plugin-include, with values read from the reviewed upstream
   tree);
3. explicitly approve the pinned install scripts;
4. verify dependency-tree uniqueness, package identity/version/provenance, the actual capabilities and DSH
   `--version`;
5. turn file links into self-contained package copies, then publish atomically.

Lock reclamation applies only to an owner with the same directory inode, the same token/PID, and confirmed
dead. A directory that exists after `mkdir` but has not yet written its owner is not proof of process death,
however old it is; a missing/corrupt owner or a leftover `.reclaim-*` waits for a bounded time and then
reports an error, with no automatic deletion. In those cases an operator must first confirm that every build
process has stopped and then clear the explicit lock residue; never bypass the lock to start a second build
when unsure. Lock tests copy the source files into a temp directory and run there; they do not clean the real
builder's lock. After upgrading the lock implementation, confirm that no builder/waiter process still loads
the old implementation before starting a new concurrent build; a change on disk does not update processes that
are already running.

If any step fails, the existing `.launcher` is not deleted; this Host start fails closed and does not
silently fall back to the official runtime. The startup console and `dsh-startup.log` record the runtime kind,
owner, compat kind and version.

## Version upgrades and removal

`supportedDshVersion` must equal `dshVersion` exactly. Sync validates it before any profile side effect, and a
plain Host start re-checks it independently. Auto-upgrade only changes the official pin, so a new version
deliberately triggers a mismatch, a sync rollback and a halted start; it never applies the old patch to
unknown new source automatically.

Before upgrading you must re-review upstream:

1. if the official release already ships all capabilities, delete `hostRuntimeCompatibility` and the related
   overlay in this directory;
2. otherwise re-derive the patch, hash, capability verification and compatibility kind/version against the
   newly pinned tag.

Do not merely edit the version string to let the build continue.

**Review seam by seam, and justify both directions directly** (a requirement of `pet-compat-minimization`):

- to decide a seam **must still be kept**: cite the target version's `.d.ts` line numbers or the original
  documentation, and explain why the official API cannot express it;
- to decide a seam **can be removed**: the evidence must cover **every** semantic it carries, not just one.

**The evidence must come from `git grep <string> HEAD`; do not read the `.upstream/` working tree, and do not
take line ranges.** `build.mjs` runs `git apply` of this patch on that directory; the build now restores it on
exit (failure paths included), but while a build is in progress, or when restoring fails, the patch content in
the working tree looks **exactly like** upstream code. In the 2026-09-23 review, three independent readers
therefore judged `settlementNotice` and `withLiveContinuableChildSession` to be official capabilities — both
have **0 hits** in a clean HEAD. The most misleading item is the patch's own marker comment ("Literal proof
that this runtime honors …"): it reads like an upstream promise but is only there so that Pet can self-check
whether the patch took effect.

Line numbers are untrustworthy too: `notifySettlement` is at `:823` in a clean HEAD and shifts to `:855` after
patching, and the offset varies with the hunks. **`git show HEAD:<file> | sed -n '<line range>'` returns other
content**; to verify whether a piece of code exists upstream, search by string only.

First run `git -C .upstream status --short`: only empty output means the working tree is trustworthy; when it
is non-empty, files on the list must be read in the way described above, while directories off the list
(`core/`, `api/`, `workspace/`, `session/`, `preset/`) can be read directly.

The second point is a lesson measured in 2026-09. At that time `createIdleContinuable` was judged removable
because the official `startContinuable` accepts `spec.childId`, missing that it also carries "do not submit
initial content" — while the official `prompt` is required; and `independent-v1` was judged removable from
`composeFrom`'s "bind, not a mount", but that sentence guarantees "an already-live child is not polluted by
the parent's later changes", not "can rebuild its composition independently of the parent". **Lookalike APIs
often solve an adjacent problem.**

### Retirement also depends on Pet's own architectural premises (added 2026-09-23)

The two points above check only whether **upstream can express it**. But whether a seam is necessary is also
decided by the **structural premises on Pet's side**, which may change before upstream does. The actual
blockers of the four current seams:

| seam | blocker | notes |
|---|---|---|
| `settlementNotice: 'silent'` | **needs a side-channel locus main session** | Its argument assumes "parent = the main session the user is working in", so `notifySettlement` going through `parent.steer()` would cut into the user's turn. The actual upstream code is `parent.status === 'idle' ? 'queue' : 'steer'` — if the parent is Pet's own standby main session (almost always idle), it takes `queue`, opening a turn in its own session and interrupting nobody. **The premise is removed by architecture; no need to wait for an upstream release.** |
| `contextMode: 'independent-v1'` + `agentPreset` | **cannot be retired as long as a locus can bind a user's own session** | A child's composition must be specified by Pet and must not drift with the parent on cold recovery. `/bind` can point at a user session running `standard`, and the official `composeFrom` can only inherit the parent's composition; it cannot express "the child uses another preset". |
| `createIdleContinuable` | the failure compensation needs redesign | The official `startContinuable({ childId })` accepts a reserved id; changing the order to "reserve the id → commit the locus row first → use the first real Delivery as the creation prompt" avoids the required `prompt`. But the current order is "the child exists first, then the row is committed"; after reversing it, a row may point to a child that does not exist. This is the same item as BACKLOG B036. |
| `withLiveContinuableChildSession` | **cannot be retired as long as the child session is still a subagent child** | The generic Session routing **deliberately** rejects a continuation-owned child (the criterion is `origin === 'subagent'`). There are 3 production consumers: the sandbox policy's apply/resolve and the delivery proof in startup recovery — all need to read and write the child session's own Session object, with no alternative path. |

**Hence none of these seams can be retired on its own**: the retirement entry for each is a structural
refactor of Pet, not a patch cleanup. When judging one removable, besides citing the upstream API you must
also point out **which architectural change removes the seam's premise, and whether that change has landed**.

The same discipline in reverse: if an architectural refactor claims to "also let some patch be retired", the
patch may be removed only **after the refactor has landed and been accepted**, and must not establish the new
premise and depend on it in the same batch of changes.

## Gate O2: does not block the no-process-execution baseline

The current baseline keeps no `bash`, `pwsh`, `run_code` or any other arbitrary process/code execution
capability. A general shell may be evaluated for retention only after separate UID/container isolation, Lark
credential isolation and a network egress policy to the Lark API have been implemented and verified; the
Host's managed `pet_locus_finish` broker must also remain available under that isolation. A separate HOME,
PATH hiding, Skill omission, prompt reminders and command-string filtering can neither replace those isolation
proofs nor serve as a reason to enable a shell. Gate O2 not being implemented does not block the current
`independent-v1` + allow-based safe composition, but it is forbidden to change the baseline back to one with
general process execution.
