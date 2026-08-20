import type { OperationRecord } from '../wire.js';
import { type ProcessRunner } from './process.js';
export declare function npmMajor(runner?: ProcessRunner, cwd?: string): Promise<number>;
export declare function dependencyFingerprint(repoPath: string, runner?: ProcessRunner): Promise<{
    fingerprint: string;
    nodeMajor: number;
    npmMajor: number;
}>;
export declare function cacheHealthy(cacheRoot: string, expected: {
    fingerprint: string;
    nodeMajor: number;
    npmMajor: number;
}, runner?: ProcessRunner): Promise<boolean>;
export declare function prepareDependencyCache(worktreePath: string, gitCommonDir: string, runner?: ProcessRunner): Promise<{
    fingerprint: string;
    nodeModules: string;
}>;
export declare function leanLinkMatches(worktreePath: string, expectedNodeModules: string): Promise<boolean>;
export declare function ensureLeanLink(worktreePath: string, expectedNodeModules: string): Promise<void>;
export declare function promoteDependencies(operation: OperationRecord, runner?: ProcessRunner): Promise<void>;
