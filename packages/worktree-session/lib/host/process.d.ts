export interface ProcessResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
export type ProcessRunner = (file: string, args: readonly string[], options: {
    cwd: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}) => Promise<ProcessResult>;
export declare const runProcess: ProcessRunner;
export declare function checkedProcess(runner: ProcessRunner, file: string, args: readonly string[], options: {
    cwd: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    code?: 'GIT_FAILED' | 'DEPENDENCY_FAILED';
}): Promise<string>;
