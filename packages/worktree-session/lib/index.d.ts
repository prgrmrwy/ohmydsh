import type { Context } from '@deepseek-ai/cordis';
export declare const name = "worktree-session";
export declare const inject: string[];
export interface Config {
    continuableDelegationTools?: readonly string[];
}
export declare function apply(ctx: Context, config?: Config): void;
export * from './wire.js';
export { startOperation, loadOperation } from './host/operation.js';
export { wsStatus, wsPromote, wsClean } from './host/maintenance.js';
