/**
 * Which caller-bound READ tools one locus child gets, by entry kind (D9/D10) and
 * by what this Host can really serve.
 *
 * The Host's composition `install` spreads this result into `registerPetTools`
 * on every publication (creation and cold resume), so this function IS the
 * production selection; tests drive it through the real tool runtime instead of
 * reading source text.
 *
 * - a document child gets the doc read and never the group-history or message read;
 * - an IM (group or topic) child gets the history read when the bot read port exists,
 *   and `pet_locus_message` exactly when {@link publishesLocusMessageTool} says so;
 * - a port that can never succeed publishes no tool rather than one that always fails.
 */

import type { LarkClient } from '../channel/lark.js'
import type { LocusMediaPort } from '../channel/media.js'
import type { LedgerCaller, LedgerCallerLocusLookup } from '../ledger/caller.js'
import type { LocusHistoryCursor } from './history-cursor.js'
import { isDocEndpoint } from './doc-endpoint.js'
import { publishesLocusMessageTool } from './message-guidance.js'

/** Inputs the Host already holds when it composes one child. */
export interface LocusEntryReadToolsInput {
  /** The child's entry; a fresh child is composed before its row exists, so the caller resolves it. */
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly lark: Pick<LarkClient, 'readEntranceHistory' | 'queryDocComment' | 'fetchDocMarkdown'>
  readonly media: LocusMediaPort
  readonly loci: LedgerCallerLocusLookup
  readonly cursor: LocusHistoryCursor
  /** Current Delivery message of a doc child, resolved by the Host's own records. */
  readonly currentDocMessageId: (caller: LedgerCaller) => string | undefined
}

/**
 * Select the read-tool dependencies for one child.
 * @param input - The child's entry and the Host's ports.
 * @returns the subset of `registerPetTools` deps to publish for this child.
 */
export function selectLocusEntryReadTools(input: LocusEntryReadToolsInput) {
  const { lark } = input
  if (isDocEndpoint(input.endpoint)) {
    return lark.queryDocComment === undefined || lark.fetchDocMarkdown === undefined ? {} : {
      locusDocContext: { loci: input.loci, currentMessageId: input.currentDocMessageId, client: lark as LarkClient },
    }
  }
  return {
    ...(lark.readEntranceHistory === undefined ? {} : {
      locusHistory: {
        loci: input.loci,
        cursor: input.cursor,
        read: (read: Parameters<NonNullable<LarkClient['readEntranceHistory']>>[0]) => lark.readEntranceHistory!(read),
      },
    }),
    ...(publishesLocusMessageTool(input.endpoint, input.media.available)
      ? { locusMessage: { loci: input.loci, media: input.media } }
      : {}),
  }
}
