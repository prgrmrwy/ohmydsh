# M0 Host and per-client activation report

## Result

Task 1.10: **PASS**.

The headless prototype uses the real rc.2 `SlotCore` for browser contribution ownership and a minimal process/client coordinator for the two activation scopes. No GUI or DSH server was started.

## Proven rc.2 slot semantics

For `sidebar.workspaces` and `conversation.hero.workspace` (`single`, root-scoped):

- official entries occupy priority `0`;
- a federation entry at priority `-1` is the active winner;
- same cell + same priority fails synchronously;
- registration disposers are idempotent;
- on a render boundary crash, rc.2 reports `abdicate: true` for non-chain slots;
- the crashed entry remains in raw `entries()` for diagnostics but is excluded from `entriesOfSlot()`;
- the next live priority survivor (the official entry) resumes;
- SlotCore and its abdication set are browser-instance-local.

Dynamic Cordis currently allocates negative priorities in newest-first order; production federation will use one explicit negative priority and own both surfaces as one per-client activation unit rather than depend on repeated dynamic-run ordering.

## Scope split

```text
DSH Host process
  HOST_DISABLED
    -> HOST_PREPARING
    -> HOST_READY
    -> HOST_DISABLED on explicit stop
  conflict/failure never commits READY

Browser tab / page generation
  CLIENT_OFFICIAL
    -> CLIENT_PREPARING
    -> CLIENT_FEDERATED
    -> CLIENT_FALLBACK on readiness or entry failure
```

Host activation owns Core, registry, local adapter, middleware and route registrations. Client activation owns only its browser's bridge, Node Shell, Workspace Embed, Picker and slot contributions.

## Executable scenarios

`tests/federation-activation.test.mjs` proves:

1. Host dependencies and registrations commit `HOST_READY` once; stop disposes in strict reverse order.
2. A route conflict rolls back and reaches `HOST_CONFLICT` without READY.
3. Two independent browser SlotCore instances become federated concurrently against one Host activation.
4. A late third tab attaches without reapplying Host activation.
5. Refresh disposes only the old page generation and activates a new generation; Host apply count remains one.
6. One client's readiness failure leaves it on official sidebar/picker while another stays federated.
7. One client's entry crash abdicates and disposes both federation surfaces in that client; official entries resume there, while another client and `HOST_READY` remain unchanged.
8. Real rc.2 priority, duplicate, disposer and abdication semantics match the coordinator assumptions.

## Runtime failure reporting nuance

A Dynamic Cordis client entry crash may report diagnostics to the Host runner and mark that client attempt failed/degraded. This is observability, not Host federation rollback: it does not retract the process-wide route/middleware transaction or another page's client contribution. The production diagnostic contract must preserve this distinction.
