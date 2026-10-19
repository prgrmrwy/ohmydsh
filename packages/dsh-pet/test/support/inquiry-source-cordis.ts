/** Test-only Cordis facade for source-transpiled agent-loop tests. */
export * from '@deepseek-ai/cordis-original';

/** Runtime mirror of upstream Cordis's const enum, inlined by production builds. */
export const FiberState = {
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
} as const;
