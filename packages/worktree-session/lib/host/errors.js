export class WsError extends Error {
    code;
    phase;
    retryable;
    details;
    cause;
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'WsError';
        this.code = code;
        if (options.phase !== undefined)
            this.phase = options.phase;
        this.retryable = options.retryable ?? false;
        if (options.details !== undefined)
            this.details = options.details;
        if (options.cause !== undefined)
            this.cause = options.cause;
    }
}
export function wireError(error) {
    if (error instanceof WsError) {
        return {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.phase === undefined ? {} : { phase: error.phase }),
            ...(error.details === undefined ? {} : { details: error.details }),
        };
    }
    return { code: 'INTERNAL_ERROR', message: 'Worktree Session failed unexpectedly', retryable: true };
}
export function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
