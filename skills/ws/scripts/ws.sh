#!/usr/bin/env bash
set -euo pipefail

if command -v dsh-ws >/dev/null 2>&1; then
  exec dsh-ws "$@"
fi

repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$repo" && -f "$repo/packages/worktree-session/lib/cli.js" ]]; then
  exec node "$repo/packages/worktree-session/lib/cli.js" "$@"
fi

if [[ -n "$repo" && -f "$repo/packages/worktree-session/package.json" ]]; then
  printf '%s\n' 'ws: generated CLI is missing; run `npm install` then `npm run build --workspace dsh-worktree-session` from the repository root (or run dsh build/sync)' >&2
else
  printf '%s\n' 'ws: dsh-worktree-session is not installed' >&2
fi
exit 1
