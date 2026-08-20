import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { bindingOf } from '../wire.js';
function gitCommonDir(repoRoot) {
    const dotGit = join(repoRoot, '.git');
    try {
        if (statSync(dotGit).isDirectory())
            return realpathSync(dotGit);
        const line = readFileSync(dotGit, 'utf8').trim();
        if (!line.startsWith('gitdir:'))
            return undefined;
        const gitDirText = line.slice('gitdir:'.length).trim();
        const gitDir = realpathSync(isAbsolute(gitDirText) ? gitDirText : resolve(repoRoot, gitDirText));
        try {
            const commonText = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
            return realpathSync(resolve(gitDir, commonText));
        }
        catch {
            return gitDir;
        }
    }
    catch {
        return undefined;
    }
}
function identityDiagnostic(operation) {
    const binding = bindingOf(operation);
    if (binding?.mode !== 'source-session')
        return 'operation is not a source-session binding';
    if (binding.state === 'cleaned')
        return undefined;
    try {
        if (!statSync(operation.worktreePath).isDirectory())
            return `managed worktree is not a directory: ${operation.worktreePath}`;
        const repoReal = realpathSync(operation.repoRoot);
        const worktreeReal = realpathSync(operation.worktreePath);
        if (!worktreeReal.startsWith(`${repoReal}/.worktrees/`))
            return `managed worktree escaped repository allocation root: ${worktreeReal}`;
        const branch = execFileSync('git', ['-C', operation.worktreePath, 'branch', '--show-current'], { encoding: 'utf8', timeout: 10_000 }).trim();
        if (branch !== operation.taskBranch)
            return `managed worktree branch ${branch || '(detached)'} does not equal ${operation.taskBranch}`;
        const common = execFileSync('git', ['-C', operation.worktreePath, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', timeout: 10_000 }).trim();
        const commonReal = realpathSync(isAbsolute(common) ? common : resolve(operation.worktreePath, common));
        if (commonReal !== realpathSync(operation.gitCommonDir))
            return `managed worktree Git common dir does not match operation metadata`;
        return undefined;
    }
    catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}
/** Synchronously recover one Session binding so session-start can install policy before first assembly. */
export function recoverBindingSync(repoPath, sourceSessionId) {
    if (repoPath === undefined)
        return undefined;
    let repoRoot;
    try {
        repoRoot = realpathSync(repoPath);
    }
    catch {
        return undefined;
    }
    const common = gitCommonDir(repoRoot);
    if (common === undefined)
        return undefined;
    const operationsDir = join(common, 'ws', 'operations');
    let names;
    try {
        names = readdirSync(operationsDir).filter(name => name.endsWith('.json')).sort();
    }
    catch {
        return undefined;
    }
    for (const name of names) {
        let operation;
        try {
            operation = JSON.parse(readFileSync(join(operationsDir, name), 'utf8'));
        }
        catch {
            continue;
        }
        const binding = bindingOf(operation);
        if (binding?.mode !== 'source-session' || binding.sourceSessionId !== sourceSessionId)
            continue;
        let operationRepoRoot;
        try {
            operationRepoRoot = realpathSync(operation.repoRoot);
        }
        catch {
            return { operation, valid: false, diagnostic: 'operation repository root is missing or invalid' };
        }
        if (operationRepoRoot !== repoRoot)
            return { operation, valid: false, diagnostic: 'source Session cwd no longer equals operation repository root' };
        const diagnostic = identityDiagnostic(operation);
        return diagnostic === undefined ? { operation, valid: true } : { operation, valid: false, diagnostic };
    }
    return undefined;
}
