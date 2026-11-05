/**
 * The `dsh-pet` storage-domain declaration.
 *
 * Kept apart from `spec.ts` on purpose: `@deepseek-ai/dsh-storage-domain` is a
 * Host-provided peer, resolvable only inside the Host's module graph. The row
 * schemas in `spec.ts` depend on zod alone, so the offline migration CLI can
 * reuse them (and the locus set validation) from an installed package.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { z } from 'zod'
import {
  PET_DOMAIN_NAME, PET_DOMAIN_VERSION, petChannelConfig, petChatBinding, petCollaborationContextRecord, petEnvEntry, petGlobalState, petInquiryAnswerRecord, petInquiryHandoffRecord, petInquiryRecord, petInquiryResultRecord, petInquiryWorkRecord, petInvocationChannel, petInvocationRecord, petLedgerItemRecord, petLocusDelivery, petLocusIndex, petLocusMainRecord, petLocusOperation, petLocusPermissionAudit, petLocusRecord, petLocusSwitchNotice, petRunRecord, petSharedFactLedgerRecord, petSkillRevision, petSkillSelection, petSourceSnapshot, petTaskRecord,
} from './spec.js'

/** The complete `dsh-pet` domain declaration. */
export const petDomainSpec = defineDomain({
  name: PET_DOMAIN_NAME,
  version: PET_DOMAIN_VERSION,
  global: {
    schema: petGlobalState,
    initial: {
      skillSetGeneration: 1,
      scopeEpochs: {},
      defaultContextPolicy: 'current-session' as const,
    },
  },
  tables: {
    tasks: domainTable<string, z.infer<typeof petTaskRecord>>(petTaskRecord),
    invocations: domainTable<string, z.infer<typeof petInvocationRecord>>(petInvocationRecord),
    snapshots: domainTable<string, z.infer<typeof petSourceSnapshot>>(petSourceSnapshot),
    runs: domainTable<string, z.infer<typeof petRunRecord>>(petRunRecord),
    skill_revisions: domainTable<string, z.infer<typeof petSkillRevision>>(petSkillRevision),
    skill_selections: domainTable<string, z.infer<typeof petSkillSelection>>(petSkillSelection),
    workspace_env: domainTable<string, z.infer<typeof petEnvEntry>>(petEnvEntry),
    channel_config: domainTable<string, z.infer<typeof petChannelConfig>>(petChannelConfig),
    chat_bindings: domainTable<string, z.infer<typeof petChatBinding>>(petChatBinding),
    invocation_channel:
      domainTable<string, z.infer<typeof petInvocationChannel>>(petInvocationChannel),
    // Unified locus storage is deliberately additive. The legacy channel tables
    // above remain declared so existing rows can be opened and preserved; the
    // locus adapter below never reads or mutates them.
    loci: domainTable<string, z.infer<typeof petLocusRecord>>(petLocusRecord),
    locus_indexes: domainTable<string, z.infer<typeof petLocusIndex>>(petLocusIndex),
    locus_deliveries: domainTable<string, z.infer<typeof petLocusDelivery>>(petLocusDelivery),
    locus_operations: domainTable<string, z.infer<typeof petLocusOperation>>(petLocusOperation),
    locus_switch_notices: domainTable<string, z.infer<typeof petLocusSwitchNotice>>(petLocusSwitchNotice),
    locus_permission_audit: domainTable<string, z.infer<typeof petLocusPermissionAudit>>(petLocusPermissionAudit),
    // Retired two-tier collaboration and inquiry tables are read-only history.
    // Keep the original parsers and keys; no runtime store writes or replays them.
    collaboration_contexts: domainTable<string, z.infer<typeof petCollaborationContextRecord>>(petCollaborationContextRecord),
    collaboration_context_revisions: domainTable<string, z.infer<typeof petCollaborationContextRecord>>(petCollaborationContextRecord),
    inquiries: domainTable<string, z.infer<typeof petInquiryRecord>>(petInquiryRecord),
    inquiry_results: domainTable<string, z.infer<typeof petInquiryResultRecord>>(petInquiryResultRecord),
    inquiry_answers: domainTable<string, z.infer<typeof petInquiryAnswerRecord>>(petInquiryAnswerRecord),
    inquiry_handoffs: domainTable<string, z.infer<typeof petInquiryHandoffRecord>>(petInquiryHandoffRecord),
    inquiry_works: domainTable<string, z.infer<typeof petInquiryWorkRecord>>(petInquiryWorkRecord),
    // Shared-fact ledger, keyed by parentSessionId. Additive at v15. One row
    // per main session that has ever registered a ledger item; ensured
    // idempotently and never deleted, including when its last item is removed.
    shared_fact_ledger: domainTable<string, z.infer<typeof petSharedFactLedgerRecord>>(petSharedFactLedgerRecord),
    // Ledger items, keyed by itemId. Additive at v15. Every row today is
    // `kind: 'todo'`; the field is a namespace partition (design D4), not a
    // discriminated union this table's schema branches on.
    ledger_item: domainTable<string, z.infer<typeof petLedgerItemRecord>>(petLedgerItemRecord),
    // Work session <-> locus main session pairing, keyed by locusMainSessionId.
    // Additive at v18; see PET_DOMAIN_VERSION.
    locus_mains: domainTable<string, z.infer<typeof petLocusMainRecord>>(petLocusMainRecord),
  },
})
