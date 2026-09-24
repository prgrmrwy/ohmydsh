/**
 * Scoped registration for the two inquiry tools.
 *
 * Same house rules as `collaboration/tools.ts`: invoke ONLY on a verified agent
 * scope, never on the Host plugin context, and treat registration as separate
 * from membership — every execution re-derives the caller and re-authorizes.
 *
 * The parameter schemas are the enforceable half of the caller-bound contract:
 * ask exposes only `target`/`question`/`purpose`, answer exposes only
 * `inquiryId` plus the answer and its explicit distinctions. Neither declares a
 * recipient, a parent, an audience, an origin or a delivery id, so those facts
 * have no spelling a model could reach for. (`nullable` is not part of this
 * DSL; `oneOf` is its union vocabulary.)
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { acceptInquiryFromCaller, type InquiryAskDependencies } from './ask.js'
import {
  submitInquiryAnswerFromCaller, INQUIRY_ANSWER_CONFIDENCE, INQUIRY_ANSWER_RECENCY,
  INQUIRY_ANSWER_LIMITS, type InquiryAnswerDependencies,
} from './answer.js'
import { INQUIRY_LIMITS } from './ledger.js'

export const INQUIRY_ASK_TOOL = 'pet_inquire'
export const INQUIRY_ANSWER_TOOL = 'pet_inquiry_answer'

/**
 * Register the caller-bound ACCEPT tool on a verified agent scope.
 *
 * There is no parent, requester, audience, origin or delivery selector: the
 * Host derives all of them from the executing session, so a model cannot ask on
 * another member's behalf or widen who may read the answer. The `target` is a
 * reference from the collaborator list and is re-authorized against current
 * membership at accept time — holding one is not permission to use it.
 */
export function registerInquiryAskTool(ctx: Context, deps: InquiryAskDependencies): () => void {
  return ctx.tools.register(defineTool({
    name: INQUIRY_ASK_TOOL,
    description: 'Ask one member of your own collaboration scope a question, asynchronously. Success means ACCEPTED AND QUEUED — it is not an answer and contains no answer. End your turn afterwards; the result comes back later as a separate correlated continuation, so do not poll or wait. You choose only whom to ask, what to ask and why: your identity, your circle, the origin of your work and who may ultimately read the reply are derived from your actual session and cannot be supplied or relabelled. A stale target reference is refused rather than redirected to a rebuilt member, so refresh your collaborator list. An inquiry does not grant either member new authority or let the requester act through the target: the target keeps its own normal policy and tool ceiling, while Host still blocks reply-target transfer, ordinary cross-agent messaging, delegation and permission or binding changes.',
    parameters: {
      target: {
        type: 'string',
        description: 'Exact target reference from your collaborator list. Not a session id you composed yourself, and not a chat, thread or user.',
        required: true,
      },
      question: {
        type: 'string',
        description: `The single question, self-contained. Max ${String(INQUIRY_LIMITS.questionLength)} characters.`,
        required: true,
      },
      purpose: {
        type: 'string',
        description: `Why you need it, so the other member can judge what is appropriate to share. State the real use: describing Feishu work as private local work is a misrepresentation, and purpose is never an authorization. Max ${String(INQUIRY_LIMITS.purposeLength)} characters.`,
        required: true,
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args, execution) {
      return { json: JSON.stringify(await acceptInquiryFromCaller(execution, args, deps)) }
    },
  }))
}

/**
 * Register the caller-bound ANSWER tool on a verified agent scope.
 *
 * Registered separately from the ask tool so a scope can be given one without
 * the other. There is no recipient parameter by contract: the requester is
 * already recorded on the inquiry, and the Host re-verifies that the executing
 * session is that inquiry's actual target — including its locus generation —
 * before anything is recorded.
 */
export function registerInquiryAnswerTool(ctx: Context, deps: InquiryAnswerDependencies): () => void {
  return ctx.tools.register(defineTool({
    name: INQUIRY_ANSWER_TOOL,
    description: 'Answer an inquiry that was addressed to you. There is no recipient argument and there cannot be one: the asker is already bound to the inquiry, and the Host verifies you are its actual target. Nothing you write elsewhere is ever taken as an answer — only this call is. Share just the working facts that fit the stated purpose: not your transcript, private messages, credentials, or anything you were told to keep restricted. Say plainly what you do not know instead of guessing; "unknown" is a valid answer. This records an answer only: it sends no chat message, settles none of your own work, and changes no shared record.',
    parameters: {
      inquiryId: {
        type: 'string',
        description: 'The id of the inquiry you are answering, exactly as you received it.',
        required: true,
      },
      answer: {
        type: 'string',
        description: `The answer itself. Max ${String(INQUIRY_ANSWER_LIMITS.answerLength)} characters.`,
        required: true,
      },
      confidence: {
        type: 'string',
        enum: [...INQUIRY_ANSWER_CONFIDENCE],
        description: '"confirmed" = you verified it in your own work; "suggested" = your best reading, not settled; "unknown" = you do not actually know. Use this field instead of hedging in the text.',
        required: true,
      },
      recency: {
        type: 'string',
        enum: [...INQUIRY_ANSWER_RECENCY],
        description: '"current" = true as of now; "as-of-recorded-work" = true when you did that work and possibly changed since; "stale" = known to be outdated; "unknown" = you cannot tell.',
        required: true,
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: `Where each claim comes from, e.g. work you performed or a shared revision you read. At least one, max ${String(INQUIRY_ANSWER_LIMITS.sources)}. If you rely on a shared revision, name it.`,
        required: true,
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args, execution) {
      return { json: JSON.stringify(await submitInquiryAnswerFromCaller(execution, args, deps)) }
    },
  }))
}
