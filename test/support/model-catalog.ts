import { SessionController } from '@deepseek-ai/dsh-api-session-controller'

/**
 * The browser model catalog projection of a live LLM registry. DSH 0.2.1 exported
 * `buildModelCatalog` from dsh-api-session-controller; 0.2.2 keeps it module-private
 * (lib/index.js:473, not in the export list at :4203) and exposes the same projection as
 * `SessionController#modelCatalog()` (lib/index.js:3951), which only reads `this.ctx`.
 */
export function buildModelCatalog(llm: unknown) {
  const ctx = { llm, agentDefaultModel: { currentSelection: () => ({}) } }
  return SessionController.prototype.modelCatalog.call({ ctx } as never)
}
