import type { Context } from '@deepseek-ai/cordis';
import type { MaintenanceTarget } from './maintenance.js';
export declare function targetFor(args: object & {
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
/** Agent-visible arguments deliberately exclude operator-only path targeting. */
export declare const WS_TOOL_PARAMETERS: {
    readonly action: {
        readonly type: "string";
        readonly required: true;
        readonly enum: readonly ["status", "promote", "clean"];
        readonly description: "Maintenance action for the exact calling Session binding.";
    };
    readonly dry_run: {
        readonly type: "boolean";
        readonly description: "For clean only, preview the safety-proven actions without removing resources.";
    };
};
/** Register the Session-oriented maintenance tool. */
export declare function registerWsTool(ctx: Context): () => void;
