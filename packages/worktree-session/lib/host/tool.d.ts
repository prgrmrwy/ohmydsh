import type { Context } from '@deepseek-ai/cordis';
import type { MaintenanceTarget } from './maintenance.js';
export declare function targetFor(args: {
    path?: string;
}, exec: {
    agent?: {
        session: {
            id: unknown;
            header: {
                cwd?: string;
            };
        };
    };
}): MaintenanceTarget | string;
/** Register the Session-oriented maintenance tool. */
export declare function registerWsTool(ctx: Context): () => void;
