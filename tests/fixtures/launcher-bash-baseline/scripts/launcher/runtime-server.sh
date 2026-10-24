#!/usr/bin/env bash
# Temporary Bash migration baseline. Source only; invoke functions explicitly.

do_stop() {
  local server_rc=0 ui_was_open=0
  is_ui_open && ui_was_open=1

  if stop_dsh_server_on_port "$PORT"; then
    echo "dsh server stopped(port $PORT)"
  else
    server_rc=$?
    case "$server_rc" in
      1) echo "no dsh server found on port $PORT" ;;
      2) echo "error: port $PORT listener is not provably DSH;refusing to kill" >&2 ;;
      3) echo "error: lsof is required to stop DSH safely" >&2 ;;
      4) echo "error: DSH server on port $PORT did not stop" >&2 ;;
      *) echo "error: failed to stop DSH server on port $PORT(rc=$server_rc)" >&2 ;;
    esac
  fi

  # UI 生命周期独立于 server 匹配结果:旧实现这里提前 return,升级后 argv
  # 改变便跳过 UI 清理,是 restart 双开的直接原因。
  if [[ $ui_was_open -eq 1 ]]; then close_ui; fi
  close_browser_ui_tabs
  if [[ $ui_was_open -eq 1 ]]; then
    echo "dsh UI stopped(PWA/浏览器标签已关闭)"
  else
    echo "dsh UI stopped(浏览器标签已清理,PWA 未在运行)"
  fi

  [[ $server_rc -eq 0 || $server_rc -eq 1 ]]
}

# stop 已负责等待精确 listener pid 退出;restart 只需确认端口确实释放。
do_restart() {
  do_stop || return 1
  if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
    echo "error: port $PORT still busy after stopping DSH" >&2
    return 1
  fi
  echo "port $PORT released"
}

is_server_up() {
  nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
}

wait_for_port() {
  local port="$1" tries="${2:-60}" pid="${3:-}"
  for _ in $(seq 1 "$tries"); do
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      return 2 # server process exited early
    fi
    if nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

initialize_server_runtime() {
  PREPARED_DSH_VERSION=""
  PREPARED_SERVER_BIN=""
  PREPARED_RUNTIME_KIND=""
  PREPARED_RUNTIME_OWNER=""
  PREPARED_RUNTIME_COMPAT=""
  PREPARED_RUNTIME_FINGERPRINT=""
}

prepare_server_runtime() {
  local resolve_out
  PREPARED_DSH_VERSION="$(dsh_version)"
  if [[ -z "$PREPARED_DSH_VERSION" ]]; then
    echo "error: dshVersion missing in $REPO/dsh.yaml" >&2
    return 1
  fi
  mkdir -p "$DSH_HOME"
  if ! resolve_out="$(DSH_CLI_VERSION="$PREPARED_DSH_VERSION" DSH_REPO_ROOT="$REPO" with_repo_registry node "$REPO/scripts/dsh-server-bin.mjs")"; then
    echo "error: 无法解析 DSH Host runtime(@deepseek-ai/dsh@$PREPARED_DSH_VERSION)" >&2
    return 1
  fi
  PREPARED_SERVER_BIN="$(printf '%s\n' "$resolve_out" | sed -n 's/^DSH_SERVER_BIN=//p' | tail -1)"
  PREPARED_RUNTIME_KIND="$(printf '%s\n' "$resolve_out" | sed -n 's/^DSH_RUNTIME_KIND=//p' | tail -1)"
  PREPARED_RUNTIME_OWNER="$(printf '%s\n' "$resolve_out" | sed -n 's/^DSH_RUNTIME_OWNER=//p' | tail -1)"
  PREPARED_RUNTIME_COMPAT="$(printf '%s\n' "$resolve_out" | sed -n 's/^DSH_RUNTIME_COMPAT=//p' | tail -1)"
  PREPARED_RUNTIME_FINGERPRINT="$(printf '%s\n' "$resolve_out" | sed -n 's/^DSH_RUNTIME_FINGERPRINT=//p' | tail -1)"
  if [[ -z "$PREPARED_SERVER_BIN" ]]; then
    echo "error: Host runtime 解析未返回 bin 路径(@deepseek-ai/dsh@$PREPARED_DSH_VERSION)" >&2
    return 1
  fi
}

start_server() {
  local VER pid server_bin runtime_kind runtime_owner runtime_compat runtime_fingerprint
  local -a env_args=() strip=()
  # 官方 dsh-web-app 默认也会打开浏览器。始终给官方 CLI 传 --no-open，
  # 确保本启动器的 open_ui 是唯一 UI opener（否则一次 dsh 会打开两个 tab）。
  if [[ -z "$PREPARED_SERVER_BIN" ]]; then prepare_server_runtime || exit 1; fi
  VER="$PREPARED_DSH_VERSION"
  server_bin="$PREPARED_SERVER_BIN"
  runtime_kind="$PREPARED_RUNTIME_KIND"
  runtime_owner="$PREPARED_RUNTIME_OWNER"
  runtime_compat="$PREPARED_RUNTIME_COMPAT"
  runtime_fingerprint="$PREPARED_RUNTIME_FINGERPRINT"

  while IFS= read -r -d '' arg; do strip+=("$arg"); done < <(server_env_strip_args)
  env_args=(env "${strip[@]+"${strip[@]}"}")
  # Re-apply the user's own override on top of the cleaned environment.
  [[ -n "$DSH_USER_REGISTRY" ]] && env_args+=("npm_config_registry=$DSH_USER_REGISTRY")

  echo "Host runtime: kind=${runtime_kind:-unknown} owner=${runtime_owner:-none} compat=${runtime_compat:-none} fingerprint=${runtime_fingerprint:-none} dshVersion=$VER"
  record_startup "$VER" "${runtime_kind:-unknown}" "${runtime_owner:-none}" "${runtime_compat:-none}" "${runtime_fingerprint:-none}"
  if [[ $FOREGROUND -eq 1 ]]; then
    "${env_args[@]}" node "$server_bin" web --port "$PORT" --no-open ${PASSTHRU[@]+"${PASSTHRU[@]}"} &
    pid=$!
    trap 'kill -TERM "${pid:-}" 2>/dev/null || true' INT TERM
    if wait_for_port "$PORT" 60 "$pid"; then
      if open_ui; then
        echo "dsh 已启动: http://127.0.0.1:$PORT (dshVersion=$VER)"
      else
        echo "dsh 已启动: http://127.0.0.1:$PORT (dshVersion=$VER;未自动打开 UI,可 dsh --open)"
      fi
      print_plugins
    elif kill -0 "$pid" 2>/dev/null; then
      echo "warn: server did not answer on port $PORT within 30s" >&2
    else
      echo "error: server exited early — check output above" >&2
    fi
    wait "$pid" || echo "dsh stopped"
  else
    nohup "${env_args[@]}" node "$server_bin" web --port "$PORT" --no-open ${PASSTHRU[@]+"${PASSTHRU[@]}"} >>"$DSH_HOME/dsh.log" 2>&1 &
    pid=$!
    disown 2>/dev/null || true
    if wait_for_port "$PORT" 60 "$pid"; then
      if open_ui; then
        echo "dsh 已启动: http://127.0.0.1:$PORT (dshVersion=$VER)"
      else
        echo "dsh 已启动: http://127.0.0.1:$PORT (dshVersion=$VER;未自动打开 UI,可 dsh --open)"
      fi
      print_plugins
    elif kill -0 "$pid" 2>/dev/null; then
      echo "warn: server did not answer on port $PORT — see $DSH_HOME/dsh.log" >&2
    else
      echo "error: server exited early — see $DSH_HOME/dsh.log" >&2
    fi
  fi
}
