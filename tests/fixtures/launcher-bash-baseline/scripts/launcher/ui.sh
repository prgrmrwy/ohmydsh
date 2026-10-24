#!/usr/bin/env bash
# Temporary Bash migration baseline. Source only; invoke functions explicitly.

# UI 对应的进程名:显式 DSH_OPEN_APP 优先,否则自动探测的 PWA;无 → 空。
ui_app_name() {
  local app="${DSH_OPEN_APP:-}"
  [[ -z "$app" ]] && app="$(pwa_app_of)"
  [[ -z "$app" ]] && return 1
  if [[ "$app" == *.app ]]; then basename "$app" .app; else echo "$app"; fi
}

# Chrome PWA 的进程 argv 是 --app-id 而非应用名,pgrep 认不出;macOS 上
# 先走 lsappinfo(按注册名取 pid),失败再回退 pgrep。
ui_pid() {
  local name
  name="$(ui_app_name 2>/dev/null)" || return 1
  if command -v lsappinfo >/dev/null 2>&1; then
    local out
    out="$(lsappinfo info -only pid "$name" 2>/dev/null | sed -n 's/^"pid"=//p')"
    [[ -n "$out" ]] && { echo "$out"; return 0; }
  fi
  pgrep -f "$name" 2>/dev/null | head -1
}

is_ui_open() { [[ -n "$(ui_pid)" ]]; }

# macOS Apple Events can wait forever when Chrome has a wedged window/process.
# Keep UI cleanup best-effort and bounded so stop/restart can always reach the
# server lifecycle. Kill only the osascript child we spawned, never Chrome.
run_osascript_bounded() {
  local timeout_s="${1:-3}" pid status=0
  shift
  osascript "$@" &
  pid=$!
  (
    sleep "$timeout_s"
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.2
    kill -KILL "$pid" 2>/dev/null || true
  ) &
  local watchdog=$!
  wait "$pid" || status=$?
  kill -TERM "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  return "$status"
}

# 优雅退出 PWA;Chrome app-mode 进程的 argv 不含应用名,ui_pid 通过
# lsappinfo 定位。AppleScript 失败或超时才按已验证的 pid 发 TERM。
close_ui() {
  local pid name
  pid="$(ui_pid)" || return 0
  name="$(ui_app_name 2>/dev/null)" || true
  if [[ -n "$name" ]] && command -v osascript >/dev/null 2>&1; then
    run_osascript_bounded 3 -e "tell application \"$name\" to quit" >/dev/null 2>&1 && {
      for _ in $(seq 1 20); do [[ -z "$(ui_pid)" ]] && return 0; sleep 0.1; done
    }
  fi
  kill -TERM "$pid" 2>/dev/null || true
}

# 清理 Chrome 普通窗口里同端口的遗留 DSH 标签。Chrome 的 AppleScript
# windows 也包含 PWA app-mode 窗口,所以必须在 close_ui 之后调用。
close_browser_ui_tabs() {
  command -v osascript >/dev/null 2>&1 || return 0
  run_osascript_bounded 3 - "$PORT" >/dev/null 2>&1 <<'APPLESCRIPT' || true
on run argv
  set targetPrefix to "http://127.0.0.1:" & (item 1 of argv) & "/"
  tell application "Google Chrome"
    repeat with w in windows
      repeat with i from (count of tabs of w) to 1 by -1
        set t to tab i of w
        if (URL of t starts with targetPrefix) then close t
      end repeat
    end repeat
  end tell
end run
APPLESCRIPT
}

is_ui_open() {
  local name
  name="$(ui_app_name 2>/dev/null)" || return 1
  pgrep -f "$name" >/dev/null 2>&1
}

# 探测已安装的 DeepSeek Harness PWA(Chrome Apps 目录)。未显式配置
# DSH_OPEN_APP 时,若唯一匹配则只开 PWA;多个/无匹配 → 浏览器。
pwa_app_of() {
  local found=""
  shopt -s nullglob nocaseglob
  for p in "$HOME"/Applications/Chrome\ Apps.localized/*DeepSeek\ Harness.app "$HOME"/Applications/*DeepSeek\ Harness.app; do
    if [[ -d "$p" ]]; then
      if [[ -n "$found" ]]; then echo ""; return 0; fi
      found="$p"
    fi
  done
  shopt -u nullglob nocaseglob
  echo "$found"
}

# UI 自动打开开关(manifest web.open):缺省 true = 保持"就绪后打开"旧行为;
# 解析失败时同样按 true 处理(fail-open,不因配置损坏静默改变行为)。
ui_manifest_open_enabled() {
  local v
  v="$(node -e '
    const path = require("node:path")
    const fs = require("node:fs")
    const yaml = require(path.join(process.argv[1], "node_modules", "js-yaml"))
    const doc = yaml.load(fs.readFileSync(path.join(process.argv[1], "dsh.yaml"), "utf8"))
    console.log(doc && doc.web && doc.web.open === false ? "" : "1")
  ' "$REPO" 2>/dev/null)"
  [[ "$v" == "1" ]]
}

# 是否允许自动打开 UI:--no-open 显式禁止;--open 强制;否则遵循 manifest web.open。
ui_should_open() {
  [[ $NO_OPEN -eq 1 ]] && return 1
  [[ $OPEN -eq 1 ]] && return 0
  ui_manifest_open_enabled
}

# 记录 UI 打开决策(时间 + 目标),便于事后溯源"是谁开了什么"。
ui_log() { printf '[%s] UI %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$DSH_HOME/dsh-ui.log"; }

open_ui() {
  if ! ui_should_open; then
    ui_log "suppressed(--no-open / web.open=false)"
    return 1
  fi
  local url="http://127.0.0.1:$PORT"
  local app="${DSH_OPEN_APP:-}"
  if [[ -z "$app" ]]; then
    app="$(pwa_app_of)"
    if [[ -n "$app" ]] && [[ "$app" == *.app && -e "$app" ]]; then
      if open "$app"; then
        echo "UI: 已打开 PWA($app)"
        ui_log "open pwa $app"
        return 0
      fi
      echo "warn: 打开 PWA 失败,回退浏览器" >&2
      app=""
    fi
  fi
  if [[ -n "$app" ]]; then
    if [[ "$app" == *.app && -e "$app" ]]; then
      # installed PWA: launch the app (it opens its own start_url);失败才回退浏览器
      if open "$app"; then
        echo "UI: 已打开 PWA($app)"
        ui_log "open pwa $app"
        return 0
      fi
      echo "warn: 打开 PWA 失败($app),回退浏览器" >&2
    else
      # application name: open the URL with it
      if open -a "$app" "$url" 2>/dev/null; then
        echo "UI: 已通过 $app 打开"
        ui_log "open app $app $url"
        return 0
      fi
      echo "warn: 打开 $app 失败,回退浏览器" >&2
    fi
  fi
  if command -v open >/dev/null 2>&1; then
    open "$url"
    echo "UI: 已打开浏览器 $url"
    ui_log "open browser $url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
    echo "UI: 已打开浏览器 $url"
    ui_log "open browser(linux) $url"
  else
    echo "dsh started — open $url"
    ui_log "print url(no opener) $url"
  fi
}
