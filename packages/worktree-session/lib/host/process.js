import { execFile } from 'node:child_process';
import { WsError } from './errors.js';
export const runProcess = (file, args, options) => new Promise(resolvePromise => {
    execFile(file, [...args], {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
    }, (error, stdout, stderr) => {
        const candidate = error;
        resolvePromise({
            code: typeof candidate?.code === 'number' ? candidate.code : error === null ? 0 : 1,
            stdout: stdout ?? '',
            stderr: stderr ?? (error?.message ?? ''),
            timedOut: error !== null && (candidate.killed === true || candidate.code === 'ETIMEDOUT'),
        });
    });
});
export async function checkedProcess(runner, file, args, options) {
    const result = await runner(file, args, options);
    if (result.timedOut)
        throw new WsError(file === 'git' ? 'GIT_TIMEOUT' : (options.code ?? 'INTERNAL_ERROR'), `${file} ${args[0] ?? ''} timed out`, { retryable: true });
    if (result.code !== 0) {
        const message = result.stderr.trim() || result.stdout.trim() || `${file} exited ${String(result.code)}`;
        throw new WsError(options.code ?? (file === 'git' ? 'GIT_FAILED' : 'INTERNAL_ERROR'), `${file} ${args.join(' ')} failed: ${message}`, { retryable: true, details: { exitCode: result.code } });
    }
    return result.stdout;
}
