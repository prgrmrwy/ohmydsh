/**
 * dsh-magpie-display-name-shim plugin entry.
 *
 * On every llm/adapters-updated (first registration and HMR replace), wrap the adapter
 * registered for the Magpie route so the picker shows gateway display names. No load-order
 * dependency: apply scans once, the event covers later registration. See src/labels.js.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { cachedLabels, wrapAdapterNames } from './labels.js';

export const name = 'dsh-magpie-display-name-shim';

export const inject = ['llm'];

export const Config = z.object({
  /** Route id registered by dsh-magpie-connect (its `providerId`). */
  providerId: z.string().default('dsh-magpie-connect'),
  /** dsh-magpie-connect's data dir (its `dataDir`); the catalog cache lives here. */
  dataDir: z.string().default(join(homedir(), '.dsh-magpie-connect')),
});

export function apply(ctx, config) {
  const labelsOf = cachedLabels(join(config.dataDir, 'magpie-models.json'));
  const ensureWrapped = () => {
    let registration;
    try {
      registration = ctx.llm.registration(config.providerId);
    } catch {
      return; // not registered yet; wait for the next adapters-updated
    }
    if (wrapAdapterNames(registration.adapter, labelsOf) && ctx.logger !== undefined) {
      ctx.logger.info(`[${name}] picker labels from gateway display names for: ${config.providerId}`);
    }
  };
  ensureWrapped();
  ctx.on('llm/adapters-updated', ensureWrapped);
}
