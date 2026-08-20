import { realpath, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promoteDependencies } from './dependencies.js';
import { WsError } from './errors.js';
import { readJson, withMkdirLock } from './fs.js';
import { createGitClient, discoverRepo, listWorktrees, worktreeStatus } from './git.js';
import { operationFile, saveOperation } from './operation.js';
import { runProcess } from './process.js';
function statusOf(operation) {
    return {
        operationId: operation.operationId,
        phase: operation.phase,
        repoRoot: operation.repoRoot,
        baseRef: operation.baseRef,
        baseCommit: operation.baseCommit,
        taskBranch: operation.taskBranch,
        worktreePath: operation.worktreePath,
        dependencyMode: operation.dependencyMode,
        ...(operation.lockFingerprint === undefined ? {} : { lockFingerprint: operation.lockFingerprint }),
        dshHome: operation.dshHome,
    };
}
export async function resolveOperation(path, git = createGitClient()) {
    const repo = await discoverRepo(path, git);
    const absolute = await realpath(path);
    const worktree = (await listWorktrees(repo.repoRoot, git))
        .filter(entry => absolute === entry.path || absolute.startsWith(`${entry.path}${sep}`))
        .sort((a, b) => b.path.length - a.path.length)[0];
    if (worktree === undefined)
        throw new WsError('OPERATION_NOT_FOUND', `No registered worktree owns ${path}`);
    const operationsDir = join(repo.gitCommonDir, 'ws', 'operations');
    let names;
    try {
        names = await (await import('node:fs/promises')).readdir(operationsDir);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            throw new WsError('OPERATION_NOT_FOUND', 'No Worktree Session operations exist');
        throw error;
    }
    for (const name of names) {
        if (!name.endsWith('.json'))
            continue;
        const operation = await readJson(join(operationsDir, name));
        if (operation?.worktreePath === worktree.path)
            return operation;
    }
    throw new WsError('OPERATION_NOT_FOUND', `Worktree is not registered to Worktree Session: ${worktree.path}`);
}
export async function wsStatus(path, git = createGitClient()) {
    return statusOf(await resolveOperation(path, git));
}
export async function wsPromote(path, options = {}) {
    const initial = await resolveOperation(path, options.git);
    const lock = join(initial.gitCommonDir, 'ws', 'locks', 'repo.lock');
    return withMkdirLock(lock, async () => {
        const operation = await resolveOperation(path, options.git);
        if (operation.phase !== 'prepared')
            throw new WsError('PROMOTE_REFUSED', `Operation phase ${operation.phase} is not prepared`);
        if (operation.dependencyMode === 'mutable')
            return { ...statusOf(operation), dependencyMode: 'mutable' };
        await promoteDependencies(operation, options.runner ?? runProcess);
        const updated = await saveOperation({ ...operation, dependencyMode: 'mutable' });
        return { ...statusOf(updated), dependencyMode: 'mutable' };
    }, { timeoutMs: 16 * 60_000, staleMs: 30 * 60_000 });
}
export async function wsClean(path, options = {}) {
    const git = options.git ?? createGitClient();
    const initial = await resolveOperation(path, git);
    const lock = join(initial.gitCommonDir, 'ws', 'locks', 'repo.lock');
    return withMkdirLock(lock, async () => {
        const operation = await resolveOperation(path, git);
        const cwd = resolve(options.cwd ?? process.cwd());
        const target = resolve(operation.worktreePath);
        if (options.requireActivePaths === true && options.activePaths === undefined)
            throw new WsError('CLEAN_REFUSED', 'Active DSH Session paths were not supplied by the trusted Host');
        const active = (options.activePaths ?? []).map(item => resolve(item));
        if (cwd === target || cwd.startsWith(`${target}${sep}`))
            throw new WsError('CLEAN_REFUSED', 'Refusing to clean the caller current worktree');
        if (active.some(item => item === target || item.startsWith(`${target}${sep}`)))
            throw new WsError('CLEAN_REFUSED', 'Refusing to clean a worktree used by an active DSH Session');
        if (operation.phase !== 'prepared')
            throw new WsError('CLEAN_REFUSED', `Operation is in-flight at phase ${operation.phase}`);
        if ((await worktreeStatus(target, git)).trim() !== '')
            throw new WsError('CLEAN_REFUSED', 'Refusing to clean a dirty worktree');
        const baseTip = await git.run(operation.repoRoot, ['rev-parse', '--verify', `${operation.baseRef}^{commit}`]);
        const taskHead = await git.run(operation.repoRoot, ['rev-parse', '--verify', `${operation.taskBranch}^{commit}`]);
        const hasProgress = await git.runner('git', ['merge-base', '--is-ancestor', operation.baseCommit, taskHead.trim()], { cwd: operation.repoRoot });
        if (hasProgress.code !== 0)
            throw new WsError('CLEAN_REFUSED', `Task branch ${operation.taskBranch} no longer descends from its recorded base commit`);
        const ancestor = await git.runner('git', ['merge-base', '--is-ancestor', taskHead.trim(), baseTip.trim()], { cwd: operation.repoRoot });
        if (ancestor.code !== 0)
            throw new WsError('CLEAN_REFUSED', `Task branch ${operation.taskBranch} is not proven merged into ${operation.baseRef}`);
        const actions = [
            `git worktree remove ${target}`,
            `git branch -d ${operation.taskBranch}`,
            `remove ${operationFile(operation.gitCommonDir, operation.operationId)}`,
        ];
        if (options.dryRun === true)
            return { dryRun: true, operationId: operation.operationId, worktreePath: target, taskBranch: operation.taskBranch, actions, cleaned: false };
        await git.run(operation.repoRoot, ['worktree', 'remove', target]);
        await git.run(operation.repoRoot, ['branch', '-d', operation.taskBranch]);
        await rm(operationFile(operation.gitCommonDir, operation.operationId), { force: true });
        return { dryRun: false, operationId: operation.operationId, worktreePath: target, taskBranch: operation.taskBranch, actions, cleaned: true };
    }, { timeoutMs: 30_000, staleMs: 30 * 60_000 });
}
