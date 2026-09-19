// GENERATED FILE — do not edit by hand.
// Source: @touchskyer/memex@0.4.1 (dist/cli.js)
// Regenerate: npm run sync:descriptions   ·   Verify: npm run check:descriptions
//
// These are the kernel's own model-facing tool descriptions, carried verbatim so
// the tool surface keeps its upstream prompting. See design.md D12.

/** Kernel version these descriptions were extracted from. */
export const KERNEL_VERSION = "0.4.1"

/** Tool name to model-facing description, as published by the kernel. */
export const TOOL_DESCRIPTIONS = {
  "memex_recall": "Retrieve persistent memory — knowledge cards from previous sessions with [[bidirectional links]]. Use when prior memory is likely relevant to the current task. Prefer a task-specific query with 1-3 keywords (ranked OR with field-weighted scoring). Call with no query only when you need the full memory index. For natural-language search, use memex_search with semantic=true instead. Never include actual secrets, credentials, tokens, or exact secret file contents in query.",
  "memex_retro": "IMPORTANT: Call this at the END of every task to save what you learned. Write one atomic insight per card with [[wikilinks]] to related cards. Only save non-obvious learnings — things that would be useful in future sessions (architecture decisions, gotchas, patterns discovered, bug root causes). Never save actual secrets, credentials, tokens, or exact secret file contents; use redacted examples instead. Handles frontmatter, source tagging, and cross-device sync automatically.",
  "memex_search": "Low-level search. Prefer memex_recall for task-start workflows. Never include actual secrets, credentials, tokens, or exact secret file contents in query; use abstract descriptions instead.",
  "memex_read": "Low-level read. Use after memex_recall to drill into specific cards.",
  "memex_write": "Low-level write. Prefer memex_retro for task-end workflows (handles frontmatter and sync automatically). Never write actual secrets, credentials, tokens, or exact secret file contents; use redacted examples instead.",
  "memex_links": "Low-level link stats. Prefer memex_organize for maintenance workflows.",
  "memex_archive": "Move a card to the archive. Use for outdated or superseded cards.",
  "memex_organize": "Analyze the card network for maintenance. Returns link stats, orphans, hubs, unresolved conflicts, and recently modified cards paired with their neighbors for contradiction detection. Call this periodically to keep the knowledge graph healthy.",
} as const

export type ToolName = keyof typeof TOOL_DESCRIPTIONS
