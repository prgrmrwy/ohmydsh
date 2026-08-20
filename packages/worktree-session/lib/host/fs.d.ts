export declare function pathExists(path: string): Promise<boolean>;
export declare function isDirectory(path: string): Promise<boolean>;
export declare function readJson<T>(path: string): Promise<T | undefined>;
export declare function atomicWrite(path: string, contents: string, mode?: number): Promise<void>;
export declare function atomicJson(path: string, value: unknown): Promise<void>;
export declare function withMkdirLock<T>(lockPath: string, action: () => Promise<T>, options?: {
    timeoutMs?: number;
    staleMs?: number;
}): Promise<T>;
export declare function touchExclusive(path: string): Promise<() => Promise<void>>;
