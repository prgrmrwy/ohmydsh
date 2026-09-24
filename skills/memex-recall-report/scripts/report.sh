#!/usr/bin/env bash
# Locate dsh-memex-recall-report and run it.
#
#   report.sh [--days N] [--lib PATH] [--scope NAME]
#
# Without --lib, runs once per library under ~/.dsh-memex (every directory
# with a cards/ subdirectory), since "never recalled" is a per-library answer.
set -euo pipefail

find_bin() {
  if command -v dsh-memex-recall-report >/dev/null 2>&1; then
    command -v dsh-memex-recall-report
    return
  fi
  local home="${DSH_HOME:-$HOME/.dsh}" candidate
  for candidate in "$home"/profiles/*/node_modules/.bin/dsh-memex-recall-report; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  local repo
  repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$repo" && -f "$repo/packages/dsh-memex/lib/cli/recall-report.js" ]]; then
    printf 'node\n%s\n' "$repo/packages/dsh-memex/lib/cli/recall-report.js"
    return
  fi
  return 1
}

# macOS ships bash 3.2: no mapfile, so read the one- or two-line answer by hand.
cmd=()
if found_bin="$(find_bin)"; then
  while IFS= read -r line; do cmd+=("$line"); done <<<"$found_bin"
fi
if [[ ${#cmd[@]} -eq 0 ]]; then
  printf '%s\n' 'memex-recall-report: dsh-memex-recall-report not found; deploy dsh-memex (dsh build) on this machine first' >&2
  exit 1
fi

for arg in "$@"; do
  if [[ "$arg" == "--lib" || "$arg" == "--help" || "$arg" == "-h" ]]; then
    exec "${cmd[@]}" "$@"
  fi
done

root="$HOME/.dsh-memex"
found=0
status=0
for lib in "$root"/*/; do
  [[ -d "${lib}cards" ]] || continue
  found=1
  printf '\n===== %s =====\n' "$(basename "$lib")"
  "${cmd[@]}" "$@" --lib "${lib%/}" || status=$?
done
if [[ $found -eq 0 ]]; then
  printf 'memex-recall-report: no libraries with a cards/ directory under %s\n' "$root" >&2
  exit 1
fi
exit "$status"
