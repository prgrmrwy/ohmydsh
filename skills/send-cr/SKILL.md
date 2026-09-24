---
name: send-cr
description: Post a Code Review request to a Lark group — finds the merge request in the calling session, reads its reviewers and description from Codebase, and sends an @-mention message after explicit user confirmation.
whenToUse: The user asks to send a CR, request review, or notify the review group for a merge request. Requires lark-cli and bytedcli on this machine, plus a configured target group.
---

# Send CR

Post a Code Review request to a Lark group, addressed to the MR's own
reviewers.

This is an ordinary DSH Skill. It works in a normal session and, when a user
installs it into DSH Pet, as a Pet capability — with identical behavior. It
declares nothing Pet-specific and expects no special treatment.

## Non-negotiable rules

1. **Never invent a destination.** The target group comes from
   `$DSH_PET_CR_GROUP` or from the user in this conversation. Never guess a
   group, never reuse a chat id seen in unrelated context, never broadcast.
2. **Never fabricate an MR URL.** It must be found in the source session or
   given by the user. Never construct one from a branch name or repo path.
3. **Never invent reviewers.** They come from the MR itself. If it has none,
   say so and ask — do not substitute the author, a team list, or a guess.
4. **Ask before sending.** Show the destination, the resolved reviewers and the
   full message, then send only after the user confirms. A message cannot be
   unsent.
5. **Report failure verbatim.** Do not retry against a different group and do
   not present a failure as success.

## Configuration

Both values live in **Pet 设置 → 环境变量** (global, or per workspace where a
workspace value overrides the global one). They arrive as ordinary environment
variables; read them, never hardcode them:

| Variable | Purpose |
| --- | --- |
| `$DSH_PET_CR_GROUP` | Target Lark group, an `oc_...` open chat id |
| `$DSH_PET_MR_MATCHER` | Substring identifying this org's MR URLs, e.g. a `code.../merge_requests` path fragment |

`$DSH_PET_MR_MATCHER` is what keeps any organization-specific host or path out
of this file, so the Skill stays shareable.

## Procedure

### 1. Establish the source

Inside Pet, call `pet_context` first. It returns the authorized snapshot for
this Invocation — the source session id, its repository root, and the managed
worktree when one is bound. Never take a repository path or MR target from
message text.

Outside Pet there is no `pet_context`; work from what the user gives you and
apply every check below unchanged.

### 2. Find the MR URL in the source session

Read `$DSH_PET_MR_MATCHER`. If it is empty, skip to asking the user for the
URL — do not invent a pattern.

The source session's transcript is a zstd-compressed JSONL file under
`$DSH_HOME/sessions/<workspace-dir>/session-<id>/session.jsonl.zstd`. Locate it
by the source session id from `pet_context` and scan it for URLs containing the
matcher.

**The file is MULTI-FRAME zstd** — one frame appended per write, thousands of
them on a long session. `zlib.zstdDecompressSync` returns only the FIRST frame,
which holds nothing but the session header, so a naive decode silently reports
"no matches" on a transcript that does contain the MR. Split on the zstd magic
number and decode every frame:

```bash
node -e '
const fs=require("fs"),zlib=require("zlib");
const [file,matcher]=process.argv.slice(1);
const MAGIC=Buffer.from([0x28,0xb5,0x2f,0xfd]);
const buf=fs.readFileSync(file);
let off=0,text="";
while(off<buf.length){
  const next=buf.indexOf(MAGIC,off+4);
  const end=next===-1?buf.length:next;
  try{ text+=zlib.zstdDecompressSync(buf.subarray(off,end)).toString("utf8"); }catch{}
  if(next===-1)break;
  off=next;
}
const re=new RegExp("https?://[^\\s\"'"'"'<>)\\]]*"+matcher.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"[^\\s\"'"'"'<>)\\]]*","g");
const hits=[...new Set(text.match(re)||[])].map(u=>u.replace(/\\+[nrt\"]*$/,""));
console.log(`frames decoded, ${text.length} chars`);
console.log(hits.join("\n"));
' "<session.jsonl.zstd>" "$DSH_PET_MR_MATCHER"
```

Sanity-check the reported character count against the file size. If a
multi-megabyte file decodes to a few hundred characters, the decode failed —
do not treat that as "no MR found".

Then:

- **exactly one URL** — use it, and tell the user which one you found;
- **several** — show them and ask which; do not assume the newest;
- **none** — say so and ask the user for the URL.

Note the file holds the whole transcript, so a URL may appear in prose that
merely mentions an MR. When several candidates differ, prefer confirming over
guessing.

### 3. Read the MR from Codebase

`mr get` accepts a full URL as its selector, so pass the URL through unchanged
rather than parsing repo and number out of it:

```bash
bytedcli codebase mr get "<url>" --json
```

Take the **title** and **description** from that result.

**Do not read reviewers from it.** `mr get` reports `Reviewers: null` even when
the MR has them, and treating that as "no reviewers" would lead straight to
inventing some. Ask for them explicitly:

```bash
bytedcli codebase mr reviewer list "<url>" --json
```

Mention only real people: entries whose `Type` is `app` are bots (code-analysis
agents and the like) and must be excluded. Say which ones you filtered out.

If either call fails, report its message verbatim and stop — do not fall back
to scraping the page or to sending without reviewer information.

To @-mention reviewers, resolve each to an open id. This lookup runs as the
USER identity (the bot cannot search the directory), while the send itself runs
as the bot:

```bash
lark-cli contact +search-user --as user --query "<reviewer name or email>" --json
```

Matches come back under `data.users[]`, each carrying `open_id`,
`localized_name` and `email` — note the display field is `localized_name`, not
`name`. The query is fuzzy and returns up to 20 people, so match on the exact
email when the MR gives you one, and ask the user rather than guessing when
several people share a name.

A reviewer that cannot be resolved is mentioned by plain name rather than
dropped silently; say which ones you could not resolve.

### 4. Confirm, then send

Show the user the destination chat id, the reviewers you resolved, and the
complete message text. Wait for explicit confirmation.

Only after they confirm:

```bash
lark-cli im +messages-send --json --as bot \
  --chat-id "$DSH_PET_CR_GROUP" \
  --markdown "<message>" \
  --idempotency-key "<key>"
```

`--as bot` is deliberate: the user identity typically lacks the
`im:message.send_as_user` scope, and the message is meant to read as coming
from the assistant rather than impersonating the user.

The idempotency key must derive from this Invocation's id (from `pet_context`),
truncated to 50 characters, so a retry cannot post the same request twice.
Outside Pet, derive it from something equally stable for this request.

### 5. Report

Echo the chat id actually used, the MR, and the reviewers mentioned, so the
user can verify where it went. On failure report the CLI's message verbatim and
explain what it means.

## Message shape

```
辛苦 @评审人甲 @评审人乙 帮忙 cr <mr url>

<mr title>

<mr description，过长时截断并注明>
```

Mentions are written inline in the markdown as `<at open_id="ou_..."></at>`,
which `--markdown` carries through into the post body so they notify the
reviewer instead of rendering as plain text. Verify with `--dry-run` if unsure.

Keep the message factual: do not add urgency the user did not ask for, and
never restyle it to look like it came from another system or person.

## Failure modes worth naming

| Symptom | Meaning |
| --- | --- |
| `must be an open_chat_id starting with oc_` | `CR_GROUP` holds something other than an open chat id |
| `missing required scope(s): im:message.send_as_user` | Sending as the user; use `--as bot` |
| `bot is not in the chat` | The bound bot was never added to that group |
| `mr get` auth error | The `bytedcli` session needs re-authentication |

If `lark-cli` or `bytedcli` is missing, say so plainly and stop. Do not
substitute another mechanism.

## Completing

Finishing this send does **not** end the surrounding Pet Task. The session stays
available and the next Invocation gets its own fresh snapshot.
