export type ContainmentResult = {
    allowed: true;
    path: string;
} | {
    allowed: false;
    reason: string;
};
/**
 * Resolve a path against a base root and require it to live physically
 * inside the root. Relative entries resolve against the base root rather than
 * any Session cwd, so they fail closed for a bound Session whose native cwd
 * is the source repo root. Existing paths are realpath-compared (eliminating
 * symlink and /var→/private style divergence); non-existent write targets
 * walk to the nearest existing ancestor inside the root and rejoin the
 * lexical remainder, which has already been shown not to escape.
 */
export declare function confinePath(base: string, entry: string | undefined, options?: {
    requireAbsolute?: boolean;
}): Promise<ContainmentResult>;
/**
 * Realpath an existing path, or (for a non-existent write target) rejoin the
 * not-yet-existing tail after the nearest existing ancestor inside the root.
 * Returns null when no ancestor resolves inside the root.
 */
export declare function resolveRealInside(baseRoot: string, path: string): Promise<string | null>;
/** True when the given Bash workdir is inside the managed root. */
export declare function confineWorkdir(base: string, workdir: string | undefined): ContainmentResult;
/** Unwrap a wrapper object argument (e.g. { filePath }) into a raw path string. */
export declare function firstPathOf(args: unknown): string | undefined;
