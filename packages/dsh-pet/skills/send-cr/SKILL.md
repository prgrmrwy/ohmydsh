---
name: send-cr
description: Send a Code Review request for a merge request to the trusted Lark group configured for the current session's workspace.
whenToUse: When the user asks to send a CR / request review / notify the review group for an MR.
---

# Send CR

Post a Code Review request to the **configured** group for the source
session's workspace.

## Non-negotiable rules

1. **You cannot choose the destination.** The group is resolved from the
   trusted workspace binding in Pet Settings → Bindings. There is no parameter
   for a chat, group or user id — do not ask the user for one and do not put
   one in the note expecting it to route anywhere.
2. **Call `pet_context` first** to confirm which source and workspace you are
   acting for.
3. **Never fabricate an MR URL.** Use one the user gave you, or one a previous
   `create-mr` Invocation returned in this Task. If you do not have a real
   URL, ask.

## Procedure

1. Call `pet_context`.
2. Establish the MR URL. If the user did not provide one and this Task has not
   created one, ask instead of guessing.
3. Call `pet_send_cr` with `mrUrl` and an optional short `note`.
4. Report the outcome:
   - **`sent`** — confirm, and state the `chatId` that was used so the user can
     verify the destination.
   - **`refused`** — report `reason` verbatim.

## When no destination is configured

The tool fails with a binding error naming the workspace. Tell the user to set
a CR group in **Pet Settings → Bindings** for that workspace. Do not attempt
any other delivery route.

## Message shape

The message body is a fixed Pet template carrying the source, the MR link and
your optional note. You cannot restyle it, and it always identifies itself as
sent by DSH Pet.

## Completing

Finishing this Invocation does **not** end the Pet Task.
