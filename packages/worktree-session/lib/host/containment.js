import { realpath } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
function doesNotEscape(ancestor, candidate) {
    const rel = relative(ancestor, candidate);
    return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}
/**
 * Resolve a path against a base root and require it to live physically
 * inside the root. Relative entries resolve against the base root rather than
 * any Session cwd, so they fail closed for a bound Session whose native cwd
 * is the source repo root. Existing paths are realpath-compared (eliminating
 * symlink and /var→/private style divergence); non-existent write targets
 * walk to the nearest existing ancestor inside the root and rejoin the
 * lexical remainder, which has already been shown not to escape.
 */
export async function confinePath(base, entry, options = {}) {
    const lexRoot = normalize(base);
    const physRoot = normalize(await realpath(base));
    if (entry === undefined || entry === '')
        return { allowed: false, reason: `worktree root policy requires an explicit managed-root path: ${physRoot}` };
    const absolute = isAbsolute(entry) ? entry : (options.requireAbsolute === true ? '' : resolve(lexRoot, entry));
    if (absolute === '')
        return { allowed: false, reason: 'worktree root policy rejects relative paths; provide an absolute managed-root path' };
    const normalized = normalize(absolute);
    // Lexical containment against the un-resolved root first, so /var vs
    // /private/var aliasing on macOS does not trip the prefix comparison.
    if (!doesNotEscape(lexRoot, normalized))
        return { allowed: false, reason: `path ${normalized} escapes the managed root ${normalize(base)}` };
    // Physical containment: realpath the target (or its nearest existing
    // ancestor) relative to the physical root to catch symlink escapes.
    const resolved = await resolveRealInside(physRoot, normalized);
    if (resolved !== null && !doesNotEscape(physRoot, resolved))
        return { allowed: false, reason: `resolved path ${resolved} escapes the managed root ${physRoot}` };
    return { allowed: true, path: normalized };
}
/**
 * Realpath an existing path, or (for a non-existent write target) rejoin the
 * not-yet-existing tail after the nearest existing ancestor inside the root.
 * Returns null when no ancestor resolves inside the root.
 */
export async function resolveRealInside(baseRoot, path) {
    try {
        const real = await realpath(path);
        return doesNotEscape(baseRoot, real) ? real : real;
    }
    catch {
        const tail = [];
        let current = path;
        let guard = 0;
        while (normalize(current) !== baseRoot && guard < 200) {
            try {
                const ancestorReal = await realpath(current);
                if (doesNotEscape(baseRoot, ancestorReal)) {
                    // Rejoin the lexical remainder onto the real ancestor.
                    return tail.length === 0 ? ancestorReal : resolve(ancestorReal, ...tail.slice().reverse());
                }
                // Preserve the escaped physical ancestor so the caller can deny it.
                return ancestorReal;
            }
            catch {
                tail.push(head(current));
                const parent = resolve(current, '..');
                if (parent === current)
                    return null;
                current = parent;
                guard += 1;
            }
        }
        return null;
    }
}
function head(path) {
    const parts = path.split(sep);
    const last = parts.pop() ?? '';
    return last;
}
/** True when the given Bash workdir is inside the managed root. */
export function confineWorkdir(base, workdir) {
    const root = normalize(base);
    if (workdir === undefined || workdir === '')
        return { allowed: false, reason: 'bash requires an explicit workdir inside the managed root' };
    if (!isAbsolute(workdir))
        return { allowed: false, reason: 'bash workdir must be an absolute managed-root path' };
    const normalized = normalize(workdir);
    if (!doesNotEscape(root, normalized))
        return { allowed: false, reason: `bash workdir ${normalized} escapes the managed root ${root}` };
    return { allowed: true, path: normalized };
}
/** Unwrap a wrapper object argument (e.g. { filePath }) into a raw path string. */
export function firstPathOf(args) {
    if (typeof args === 'string')
        return args;
    if (typeof args === 'object' && args !== null) {
        for (const key of ['path', 'filePath', 'dir', 'directory', 'cwd', 'root']) {
            const value = args[key];
            if (typeof value === 'string')
                return value;
        }
    }
    return undefined;
}
