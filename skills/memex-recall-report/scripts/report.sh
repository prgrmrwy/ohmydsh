#!/usr/bin/env bash
# Legacy POSIX forwarding only; use Node on every platform.
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/report.mjs" "$@"
