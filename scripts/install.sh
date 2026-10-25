#!/usr/bin/env bash
# Legacy POSIX entry; cross-platform installation is npm ci then npm link.
set -euo pipefail
command -v node >/dev/null 2>&1 || { echo 'error: Node.js >=22 is required; install from https://nodejs.org/' >&2; exit 1; }
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
exec node "$(dirname "$SOURCE")/install.mjs" "$@"
