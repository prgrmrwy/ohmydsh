import type { GitClient } from './git.js';
export declare function ensureWorktreeExclude(gitCommonDir: string): Promise<void>;
export declare function shellSingleQuote(value: string): string;
export declare function managedEnvironment(content: string, dshHome: string): string;
export declare function prepareEnvironment(repoRoot: string, worktreePath: string, gitCommonDir: string, operationId: string, git?: GitClient): Promise<string>;
