#!/usr/bin/env bash
# Legacy POSIX entrypoint; all initialization logic lives in bootstrap.mjs.
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'error: Node.js is missing. Install Node >=22.0.0 and npm >=10.0.0 (package.json engines): https://nodejs.org/' >&2
  exit 1
fi
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
exec node "$(dirname "$SOURCE")/bootstrap.mjs" "$@"
