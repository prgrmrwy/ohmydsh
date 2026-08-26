# Live remote node probe (M3 partial evidence)

Executed against real SSH aliases from the operator's own `~/.ssh/config`
through the federation code under test. All identifying values below are
redacted; no session content, path, token or key material is recorded.

## 1. SSH identity probe (BatchMode, no remote command)

`probeSshIdentity`-shaped argv (`-N -T -o SessionType=none -o BatchMode=yes`)
against four configured aliases:

| Alias (redacted) | Result |
| --- | --- |
| alias-A | authenticates, tunnel-capable |
| alias-B | authenticates, tunnel-capable |
| alias-C | authenticates, tunnel-capable |
| alias-D | unreachable — TCP connect timeout to port 22 |

The unreachable alias produced exactly the layered diagnostic the spec requires
(`SSH_TRANSPORT_FAILED`-class connect timeout), not a generic failure.

## 2. Loopback tunnel + DSH protocol probe

Real `ssh -L 127.0.0.1:<candidate>:127.0.0.1:3080` forwarding, then a
`host.describe` client-request envelope over the tunnel:

| Alias | Outcome |
| --- | --- |
| alias-A | HTTP 200, valid rc.2-shaped `server-response` for `host.describe` |
| alias-B | `channel open failed: connect failed: Connection refused` → no DSH listening |
| alias-C | `channel open failed: connect failed: Connection refused` → no DSH listening |

This confirms the corrected OpenSSH semantics in the approved design: the local
`-L` bind succeeded and `ssh` stayed alive in all three cases, and only the
in-tunnel DSH probe distinguished a real DSH from a closed remote port. A
listener-only success is therefore never published as READY.

## 3. Adapter behaviour against the live node

`DshRc2NodeAdapter.probe` + real baseline reads through `HttpUnaryCarrier`:

```
compatibility : EXPERIMENTAL
version       : 0.0.1
diagnostic    : "unverified version; only live-probed read capabilities enabled"
capabilities  : workspace.read, session.read, session.search, session.attachment,
                directory.read, events.mux, events.host
writes        : none granted
```

> **Superseded interpretation.** This run predates
> `rc2-live-conformance-report.md`, which proved against a real rc.2 `dsh web`
> that rc.2 **hardcodes** `host.describe.version = "0.0.1"`
> (`dsh-host-apiproxy/lib/index.js:3110`). The reported `0.0.1` above is
> therefore *not* evidence that the remote is not rc.2, and the
> `EXPERIMENTAL`/read-only outcome recorded here was produced by the
> since-fixed exact-version gate, which would have denied writes to every
> genuine rc.2 node. The probe now decides on structural proof; this node's real
> compatibility is unknown until re-probed with the corrected adapter.

Baseline conversion over the live node:

- `workspace.list` → 2 workspaces projected;
- `session.list` → 19 sessions projected;
- every projected id carried its owning node prefix (`fed1:<node>:w:` /
  `fed1:<node>:s:`), verified programmatically.

**Key result (as later corrected).** The conservative fallback path itself
behaved as specified: an unrecognised version yielded `EXPERIMENTAL` with
read-only capabilities and no manual intervention. What this run could *not*
tell was whether `0.0.1` genuinely indicated a non-rc.2 node — the live
conformance run showed it does not, because rc.2 reports that constant. The
policy remains `semverInference: false`, but "verified" is now proven by
structural probe rather than by an exact version string.

## 4. What this does and does not prove

Proven on real infrastructure:

- system OpenSSH BatchMode identity probing with no remote command execution;
- candidate-port loopback forwarding and cleanup of the owned child only;
- separation of local bind success from in-tunnel DSH readiness;
- unary carrier envelope/decoding against a live remote Host;
- workspace/session baseline translation and federated-ownership tagging;
- conservative capability gating for an unverified remote version.

**Not proven and explicitly still open:**

- three simultaneous nodes each running a *verified rc.2* DSH (only one live DSH
  node was reachable; its true version is undetermined because rc.2's reported
  version is a constant);
- remote write acceptance against *this* node (writes were withheld here by the
  since-corrected version gate; the write surface was instead proven against a
  real local rc.2 `dsh web` — see `rc2-live-conformance-report.md`);
- deliberately colliding native workspace/session ids across three live nodes
  (covered so far only by the synthetic three-node proof);
- real remote Claude-subscription prompt/stream/tool/approval acceptance;
- central-restart and disconnect recovery against multiple live nodes;
- the deployed-GUI acceptance run, which requires enabling the manifest entry.

Tasks 10.1–10.3 therefore remain open, and `dsh.yaml` keeps
`dsh-federation: enabled: false`.
