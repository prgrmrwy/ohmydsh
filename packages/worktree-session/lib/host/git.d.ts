import type { RefEntry, WorktreeEntry } from '../wire.js';
import { type ProcessRunner } from './process.js';
export interface RepoFacts {
    repoRoot: string;
    gitCommonDir: string;
    currentBranch?: string;
    currentCommit: string;
}
export interface GitClient {
    runner: ProcessRunner;
    run(cwd: string, args: readonly string[], timeoutMs?: number): Promise<string>;
    maybe(cwd: string, args: readonly string[], timeoutMs?: number): Promise<string | undefined>;
}
export declare function createGitClient(runner?: ProcessRunner): GitClient;
export declare function discoverRepo(path: string, git?: GitClient): Promise<RepoFacts>;
export declare function listRefs(repoRoot: string, git?: GitClient): Promise<RefEntry[]>;
export declare function resolveCommit(repoRoot: string, ref: string, git?: GitClient): Promise<string>;
export declare function listWorktrees(repoRoot: string, git?: GitClient): Promise<WorktreeEntry[]>;
export declare function worktreeStatus(path: string, git?: GitClient): Promise<string>;
export declare function taskSlug(taskText: string): string;
export declare function validateBranch(branch: string, repoRoot: string, git?: GitClient): Promise<void>;
export declare function branchExists(repoRoot: string, branch: string, git?: GitClient): Promise<boolean>;
export declare function allocateTask(repoRoot: string, taskText: string, git?: GitClient): Promise<{
    slug: string;
    branch: string;
    path: string;
}>;
export declare function createTaskWorktree(repoRoot: string, branch: string, path: string, baseCommit: string, git?: GitClient): Promise<void>;
export declare function pruneInvalidRegistrations(repoRoot: string, git?: GitClient): Promise<readonly string[]>;
export declare function withinRepo(repoRoot: string, candidate: string): boolean;
export declare function repoNameFromCommonDir(commonDir: string): string;
