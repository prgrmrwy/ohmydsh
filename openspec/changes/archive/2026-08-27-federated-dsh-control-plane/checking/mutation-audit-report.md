# Mutation audit of the load-bearing invariants

Round 13 exposed a test that passed while proving nothing (a "concurrent" race
that `spawnSync` had silently serialized). This audit applies the same technique
systematically: break each safety-critical invariant in the real source, confirm
a test fails, restore, and verify the source is clean.

A surviving mutation means the invariant is unprotected — a silent regression
would ship.

## Results

| Invariant broken | Outcome |
| --- | --- |
| ledger: allow replay of `OUTCOME_UNKNOWN` writes | **detected** |
| id codec: accept an unknown node | **detected** |
| id codec: ignore workspace/session kind mismatch | **detected** |
| router: skip the capability gate | **detected** |
| router: allow writes to a non-authoritative node | **detected** |
| registry storage: accept a symlinked registry | **detected** |
| registry storage: accept an over-wide file mode | **detected** |
| OpenSSH: publish an endpoint without the readiness proof | **detected** |
| OpenSSH: accept an option-shaped alias | **detected** |
| OpenSSH: drop stderr redaction | **detected** |
| projection: leak archived sessions into the active tree | **detected** |
| drag scope: allow a cross-workspace session move | **detected** |
| row menu: hand a remote path to the local editor | **detected** |
| extensions: offer the editor action on a remote node | **detected** |
| `probeOptional` swallows *all* errors, not just business refusals | **detected** |
| adapter: remove the runtime allowlist check in the dispatcher | **survived** → investigated below |

## The one survivor, and what it actually means

Removing `if (!RC2_ALLOWED_METHODS.has(method))` from the shared dispatcher
survived. Two rounds of added assertions still failed to detect it, so I stopped
adding tests and read the call graph instead.

**Finding:** every `this.#call(...)` site passes a *hardcoded literal* method
name, and all 14 literals are already allowlisted. No input can reach the guard
through those paths, so no test can detect its removal there. It is defense in
depth against *future* code, not against any current input — and pretending
otherwise with a contrived test would have been fake coverage.

**But the guard is not entirely unreachable.** `probeOptional` forwards a
**dynamic** `method`, so the check is live on that path. That matters because
`probeOptional` deliberately maps a `RemoteBusinessError` to "capability absent".
If the allowlist rejection were also a business error, a refused method would be
silently reported as an unsupported capability. It is a Protocol `CarrierError`,
so it propagates instead — now asserted directly:

- a deployment-level refusal → capability reported absent, node stays SUPPORTED;
- a protocol fault → propagates as `Protocol`, never silently downgraded.

Mutating `probeOptional` to swallow every error is **detected**.

**Structural guard added.** Because the literal-only property is what makes the
runtime check unreachable, that property is now pinned in
`packages/dsh-federation/tests/boundaries.test.ts`:

- every `this.#call(` site must open with a single-quoted literal;
- exactly one `rpc(carrier, …)` site may forward a dynamic method
  (`probeOptional`);
- every literal that is sent must be in `RC2_ALLOWED_METHODS` and absent from
  `RC2_FORBIDDEN_METHODS`.

Verified: introducing a dynamic method at a call site (`this.#call(pickMethod(), …)`)
is **detected**. So a future change that makes the runtime guard reachable also
forces the reviewer to notice.

## Verification

`dsh-federation` package → **120 passed** (was 117); root `npm test` →
**91 passed, 0 failed**; typecheck clean. Every mutation was reverted and the
sources verified unmodified. Nothing touches `~/.dsh`; `dsh.yaml` keeps
`dsh-federation: enabled: false`.
