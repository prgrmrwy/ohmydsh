# Per-client activation against the real rc.2 SlotCore

Automated as `tests/federation-client-activation-live.test.mjs`.

## Gap this closes

Per-client UI activation had two separate proofs, neither of which covered the
shipped code against the real registry:

- `packages/dsh-federation/tests/client-activation.test.ts` drives the shipped
  `ClientActivationController` through a hand-written `FakeSlots`;
- `tests/federation-activation.test.mjs` uses the **real** `SlotCore` from
  `@deepseek-ai/dsh-client-ui-slots`, but drives
  `scripts/federation-activation-prototype.mjs` — a throwaway M0 prototype, not
  the class that ships.

So the shipped controller had never met the real registry. This test pairs them.

## Real SlotCore facts discovered

Two API facts had to be learned from the real implementation rather than assumed:

1. **Slots must be declared before registration.** `SlotCore.register` throws
   `slot "sidebar.workspaces" is not declared (a parent entry's children table
   must declare it)`. The fixture therefore registers a `root` entry declaring
   both holes, exactly as the official shell does.
2. **`entriesOfSlot()` returns only the single winner; `entries()` returns every
   registration.** An assertion counting "one federation entry plus the official
   entry" must use `entries()`.

## Scenarios verified

| # | Property | Result |
| --- | --- | --- |
| 1 | federation at priority `-1` shadows both official entries | winner flips to federation on both slots |
| 2 | a real SlotCore priority collision on the *second* contribution | client rolls back to `CLIENT_FALLBACK`, diagnostic `already has a registration`, official remains winner on the first slot — no half-shadowed sidebar |
| 3 | real `reportEntryError(..., { abdicate: true })` | controller reaches `CLIENT_FALLBACK` and disposes **both** federation surfaces; official wins both slots again |
| 4 | two independent clients, one crashing | crashed client falls back; the other stays `CLIENT_FEDERATED` and keeps its own winner |
| 5 | refresh | generation increments and the registry holds exactly one federation entry per slot — no accumulation |
| 6 | dispose | registry returns to the official winner with a single entry |

Scenario 2 is the one the fake could not express: the collision is raised by the
real registry's own priority bookkeeping, and it proves the controller's
reverse-order rollback under a genuine partial failure.

## Mutation checks

| Mutation in `src/client/activation.ts` | Test result |
| --- | --- |
| remove the reverse-order rollback of partial registrations | **failed** ✓ |
| ignore abdication reported by the registry | **failed** ✓ |

Source restored and verified clean (0 mutation markers).

## Verification

`npm test` → **87 passed, 0 failed**; `dsh-federation` package → **117 passed**;
typecheck clean. Nothing touches `~/.dsh`; `dsh.yaml` keeps
`dsh-federation: enabled: false`.
