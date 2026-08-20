import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperationRecord } from '../wire.js';
export interface RouteRegistration {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface HostRouteDeps {
    activeSessionPaths?: () => readonly string[];
    activeBoundSessionIds?: () => readonly string[];
    /** Validate the source Session against the durable operation and synchronously install scoped policy. */
    bindLiveSource?: (sourceSessionId: string, operation: OperationRecord, options: {
        requireBlank: boolean;
    }) => void;
    /** Refresh an already-bound live Session after Host restart/UI resume. */
    recordBind?: (sourceSessionId: string, operation: OperationRecord | undefined) => void;
}
export declare function createRoutes(deps?: HostRouteDeps): readonly RouteRegistration[];
