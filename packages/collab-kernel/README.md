# collab-kernel

English · [简体中文](README.zh.md)

<!-- problem -->
Independent sessions need a shared record of agreements, requests and verified human decisions without tying the rules to one host. This TypeScript library supplies that kernel with zero runtime dependencies. It is not a DSH plugin and is not registered in the deployment manifest; a future `dsh-collab` plugin will inline it at build time.

## Scope

The kernel provides named, principal-authorized commands, revision-bound acknowledgments, durable command receipts, a local JSONL store, provider-based delivery, bounded wake loops and a pure Markdown overview. A human decision requires evidence from a trusted provider and a matching successful confirmation delivery. `decided` is terminal.

There is no real host integration or human channel in this package. The host verifies identities and constructs principals; providers are trusted code, not an authentication sandbox. Agent-provided claims of human approval are not confirmation evidence.

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

// providers implement claim, presence, deliver and requestConfirmation.
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
