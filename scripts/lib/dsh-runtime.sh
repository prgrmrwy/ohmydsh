#!/usr/bin/env bash
# DSH launcher runtime helpers. Source from bin/dsh; no top-level side effects.

# Print listener PIDs for one TCP port. Requires lsof on macOS/Linux.
dsh_listener_pids() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || return 3
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
}

# Accept only the DSH web argv forms observed across npm/npx releases.
is_dsh_web_pid() {
  local pid="$1" command
  command="$(ps -o command= -p "$pid" 2>/dev/null)" || return 1
  case "$command" in
    *"/node_modules/.bin/dsh web"*|*"npm exec @deepseek-ai/dsh@"*" web"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Stop the DSH process tree owning a port. Return codes:
# 0 stopped; 1 no listener; 2 listener is not provably DSH; 3 lsof unavailable;
# 4 DSH did not exit after TERM/KILL.
stop_dsh_server_on_port() {
  local port="$1" pids pid parent parent_command still="" attempts="${2:-40}"
  command -v lsof >/dev/null 2>&1 || return 3
  pids="$(dsh_listener_pids "$port" || true)"
  [[ -n "$pids" ]] || return 1

  # Fail closed before sending any signal when ownership cannot be proven.
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    is_dsh_web_pid "$pid" || return 2
  done <<< "$pids"

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    if [[ -n "$parent" ]]; then
      parent_command="$(ps -o command= -p "$parent" 2>/dev/null || true)"
      case "$parent_command" in
        *"npm exec @deepseek-ai/dsh@"*" web"*) kill -TERM "$parent" 2>/dev/null || true ;;
      esac
    fi
    kill -TERM "$pid" 2>/dev/null || true
  done <<< "$pids"

  for _ in $(seq 1 "$attempts"); do
    still="$(dsh_listener_pids "$port" || true)"
    [[ -z "$still" ]] && return 0
    sleep 0.25
  done

  # Revalidate every remaining listener before force:the port may have been
  # rebound by another process while we waited.
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    is_dsh_web_pid "$pid" || return 2
    kill -KILL "$pid" 2>/dev/null || true
  done <<< "$still"
  sleep 0.1
  [[ -z "$(dsh_listener_pids "$port" || true)" ]] || return 4
  return 0
}
