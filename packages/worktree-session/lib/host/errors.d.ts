import type { OperationPhase, WsErrorCode, WsWireError } from '../wire.js';
export declare class WsError extends Error {
    readonly code: WsErrorCode;
    readonly phase?: OperationPhase;
    readonly retryable: boolean;
    readonly details?: Record<string, string | number | boolean>;
    readonly cause?: unknown;
    constructor(code: WsErrorCode, message: string, options?: {
        phase?: OperationPhase;
        retryable?: boolean;
        details?: Record<string, string | number | boolean>;
        cause?: unknown;
    });
}
export declare function wireError(error: unknown): WsWireError;
export declare function messageOf(error: unknown): string;
