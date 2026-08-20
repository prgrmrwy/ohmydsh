import type { IncomingMessage, ServerResponse } from 'node:http';
export interface RouteRegistration {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface HostRouteDeps {
    activeSessionPaths?: () => readonly string[];
}
export declare function createRoutes(deps?: HostRouteDeps): readonly RouteRegistration[];
