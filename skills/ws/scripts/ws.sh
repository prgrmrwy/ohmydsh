#!/usr/bin/env bash
set -euo pipefail

if command -v dsh-ws >/dev/null 2>&1; then
  exec dsh-ws "$@"
fi

repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$repo" && -f "$repo/packages/worktree-session/lib/cli.js" ]]; then
  exec node "$repo/packages/worktree-session/lib/cli.js" "$@"
fi

printf '%s\n' 'ws: dsh-worktree-session is not installed or built' >&2
exit 1
