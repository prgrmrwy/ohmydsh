# collab-kernel

English · [简体中文](README.zh.md)

<!-- problem -->
Independent sessions need a shared record of agreements, requests and messages without tying the rules to one host. This TypeScript library supplies that kernel with zero runtime dependencies. It is not a DSH plugin and is not registered in the deployment manifest; a future `dsh-collab` plugin will inline it at build time.

## Scope

The kernel provides named, principal-authorized commands, revision-bound acknowledgments, durable command receipts, a local JSONL store, provider-based delivery, three wake triggers (a `needsReply` message, an invitation, a request reaching `done`/`rejected`), per-topic loop limits through optional `ref` (20 waking messages per topic, then `COLLAB_THREAD_LIMIT`) and a pure Markdown overview. Logs written before per-topic limits replay unchanged; their decision, breaker and escalation records are read-only history.

Integrator extension points:

- **Managed members.** A provider declaring `managed: true` is an integrator. After a Leader grants its channel per space with `allowManager`, it runs `admitMember`/`rebindMember`/`retireMember` as `principals.manager`. A rebind keeps the member name, and an old address is never reused. `disposeManagedRequest` lets it settle, on the user's behalf, a request authored by one of its managed members (`open → accepted|done|rejected`, `accepted → done|rejected`); it wakes nobody.
- **Commit time.** Every new commit record carries `at`, epoch milliseconds from `ServiceOptions.now` (default `Date.now`), covered by the row checksum. Receipt replays write nothing; commits written before `at` existed replay without it.
- **`ext`.** Items and messages may carry an opaque JSON object of at most 4096 canonical bytes. The kernel stores it without interpreting it, and keeps it out of projections and pointers.
- **`mode`.** A needs-reply message may name a delivery mode. The recipient provider's synchronous `supportsMode` decides whether it is accepted; an unsupported mode is rejected.
- **Call guard.** Read and write contexts may carry a host-created synchronous `guard`, called after the last await and before any commit or returned data. Managed-channel and manager calls must carry one.

There is no real host integration in this package, and new members are agents only. The host verifies identities and constructs principals; providers are trusted code, not an authentication sandbox.

## Build and test

Install development dependencies at the workspace root, then run:

```bash
npm --workspace packages/collab-kernel test
npm --workspace packages/collab-kernel run typecheck
npm --workspace packages/collab-kernel run build
```

The source is under `src`; generated `lib` stays ignored. The type check covers both production code and tests. Markdown parsing and import scanning are test tools, not runtime dependencies.

## Minimal usage

```ts
import { CollabService, FileStore, principals } from 'collab-kernel'

// providers implement claim, presence and deliver.
const service = new CollabService({ serviceId: 'host-1', store: new FileStore('./collaboration'), providers })
const context = {
  spaceId: 'release-1',
  principal: principals.agent({ channel: 'sessions', address: 'session-1' }),
}
await service.createSpace({ ...context, cmdId: 'create-release-1' }, {
  name: 'owner', kind: 'agent', address: 'session-1',
})
const overview = await service.overview(context)
await service.close(context.spaceId)
```

Use a stable `cmdId` to resolve unknown command outcomes after recovery. All four service reads require an active member or internal principal. Storage `read(fromSeq)` is inclusive; service `readSince(seq)` is exclusive. Read results are snapshots and do not advance any stored cursor.

## Recovery and delivery

- One store instance holds an exclusive lock per space. `close` drains storage work, not indefinitely pending provider calls.
- A storage failure fences further work. Close, reopen, and retry a public command with its original `cmdId` and payload. Never infer success from a failed fsync.
- `breakLock` is a trusted host operation: matching the instance ID is necessary but does not prove death. The host must prove the old holder no longer exists; unknown or live holders stay locked.
- Delivery intentions are committed before SPI calls. Calls have no timeout. Recovered unknown deliveries are listed but never automatically sent again; a late callback cannot write through a closed generation.
- For a future bundled consumer, build from current kernel source or explicitly build this library first. Track its source directory and actual package/build configurations; watching source while bundling old `lib` does not produce a current artifact.

## Removal
<!-- section: removal -->

This package connects the collaboration rules to a future `dsh-collab` build-time consumer. Remove it when no consumer imports or inlines it, or after migrating consumers to a maintained replacement. Close active stores and retain their journals before removing code; removing the package does not migrate or delete collaboration data.
