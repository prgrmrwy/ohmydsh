# Live Jev probe runbook

This runbook never accepts a key as a command argument and never asks the user to paste a key into chat.

## 1. Revoke exposed credentials

Any key previously pasted into chat must be revoked before proceeding. Create a replacement in the TypeSafe console.

## 2. Configure only the local private environment

On the user's machine, edit the repository's gitignored `.env.local` and add:

```bash
TYPESAFE_API_KEY="<replacement key>"
```

Do not commit the file. Do not put the value in `dsh.yaml`, a shell command, an evidence file, stdout/stderr, or a session message.

## 3. Restart the existing Host

The user runs:

```bash
dsh restart
```

The agent must not do this from the active session because restart interrupts that session.

## 4. Check readiness without reading the value

After reconnecting:

```bash
node scripts/jev-readiness.mjs
```

Required facts before a paid/live decision:

- `credential.privateEnvDeclaration` or `credential.currentProcess` is true;
- all exact package fields are true;
- both insertion rows are true;
- current request headers list both `mcp__jev__jev_classify` and `mcp__jev__jev_decide`;
- the router and all nine spec-superflow skills remain visible.

The probe reports booleans and public tool/skill names only. It sets `valueInspected:false` and never emits the credential.

## 5. Run one bounded typed decision

Use only fixed enum/numeric/boolean router features and closed candidate descriptions. Do not send prompt text, conversation text, source, paths, identifiers, URLs, attachments, or secrets. Record only:

- exact Jev package/version;
- candidate catalog version and eligible candidate names;
- schema/closed-distribution validation result;
- normalized status/error category;
- latency and aggregate usage;
- whether redaction checks passed.

Do not retain the request body or raw provider response/error. The result remains shadow-only and must not create a change, choose a schema, invoke `ssf`, apply, merge, or archive.

## 6. Fail safely

If either tool is absent, the response is malformed, the provider fails, or credentials are rejected/rate-limited, record the finite normalized category and continue the pre-existing authoritative workflow. Do not retry ambiguous failures and do not weaken existing Worktree/OpenSpec gates.
