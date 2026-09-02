---
name: send-cr
description: Send a Code Review request for a merge request to the trusted Lark group configured for the current session's workspace.
whenToUse: When the user asks to send a CR / request review / notify the review group for an MR.
petLabel: Send CR
petIcon: 📣
petContext: session-required
---

# Send CR

Post a Code Review request for a merge request to the review group.

Pet provides no `send-cr` tool. You send it yourself with ordinary tools
(`bash`), under Pet's Skill allowlist — every constraint below is this Skill's
responsibility.

## Non-negotiable rules

1. **Never invent a destination.** Use only a chat id the user gave you in
   this Task, or one they confirm when you ask. Do not guess a group, do not
   reuse a chat id seen in unrelated context, and do not broadcast to a list.
2. **Call `pet_context` first** to confirm which source you are acting for.
3. **Never fabricate an MR URL.** Use one the user provided, or one a previous
   Invocation in this Task produced. If you do not have a real URL, ask.
4. **Ask before sending.** Show the exact destination and message text, and
   send only after the user confirms. A message cannot be unsent.

## Procedure

1. Call `pet_context`.
2. Establish the MR URL and the destination chat id. Ask for whatever is
   missing rather than inferring it.
3. Show the user the rendered message and the destination, and wait for
   confirmation.
4. Send:

   ```bash
   lark-cli im +messages-send --json \
     --chat-id <oc_...> \
     --text "<message>" \
     --idempotency-key "pet-<invocation id from pet_context>"
   ```

   The idempotency key must derive from this Invocation's id, so a retry
   cannot post the same review request twice.
5. Report the outcome, echoing the chat id actually used so the user can
   verify where it went. Report a refusal verbatim.

## Message shape

Keep it structured and self-identifying:

```
【Code Review 请求】
来源：<source title from pet_context>
MR：<url>
说明：<optional short note>
（由 DSH Pet 发送）
```

Never restyle it to look like it came from another system or person.

## Completing

Finishing this Invocation does **not** end the Pet Task.
