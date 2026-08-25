#!/usr/bin/env bash
# ohmydsh/scripts/dsh-tunnel.sh — 从另一台机器经 SSH 隧道访问本机 DSH Web GUI。
#
# 本脚本运行在**客户端**(想访问 DSH 的那台电脑),不是跑 DSH 的那台。
#
#   用法:
#     ./scripts/dsh-tunnel.sh                    起隧道(自动退避占用端口)
#     ./scripts/dsh-tunnel.sh status             查看隧道状态
#     ./scripts/dsh-tunnel.sh stop               关闭本脚本起的隧道
#     ./scripts/dsh-tunnel.sh -p 9000            指定本地端口(仍会在占用时退避)
#     ./scripts/dsh-tunnel.sh --strict           端口被占则直接失败,不退避
#     ./scripts/dsh-tunnel.sh --no-open          不自动打开浏览器
#
#   环境变量(可写进 shell rc 免去每次传参):
#     DSH_TUNNEL_HOST    远端主机(跑 DSH 的机器),默认 192.168.64.3
#     DSH_TUNNEL_USER    远端用户名,默认 prgrmrwy
#     DSH_TUNNEL_PORT    远端 DSH 端口,默认 3080
#     DSH_TUNNEL_LOCAL   本地起始端口,默认与远端端口相同
#
# 端口退避:本地端口被占用时自动 +1 依次探测(最多 20 次)。这只挪动**本地**端口,
# 远端 DSH 端口始终不变——两侧端口互相独立。为避免「SSH 连上但转发未建立」的
# 假象(OpenSSH 默认仅告警),转发始终带 ExitOnForwardFailure=yes。
#
# 安全:隧道全程走 SSH 加密,公钥免登;DSH 保持回环绑定,局域网零端口暴露。
# 背景与取舍见 docs/notes/lan-access-ssh-tunnel.md。
set -euo pipefail

REMOTE_HOST="${DSH_TUNNEL_HOST:-192.168.64.3}"
REMOTE_USER="${DSH_TUNNEL_USER:-prgrmrwy}"
REMOTE_PORT="${DSH_TUNNEL_PORT:-3080}"
LOCAL_PORT="${DSH_TUNNEL_LOCAL:-$REMOTE_PORT}"
MAX_PROBE=20
STRICT=0
OPEN_BROWSER=1
ACTION="start"

# 隧道标记:用于 status/stop 精确识别本脚本起的进程,不误伤别的 ssh。
TAG="dsh-tunnel"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

# ---------- 参数解析 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    start|status|stop) ACTION="$1"; shift ;;
    -p|--port) LOCAL_PORT="${2:-}"; [[ -n "$LOCAL_PORT" ]] || die "-p 需要端口号"; shift 2 ;;
    --port=*) LOCAL_PORT="${1#*=}"; shift ;;
    -H|--host) REMOTE_HOST="${2:-}"; shift 2 ;;
    --host=*) REMOTE_HOST="${1#*=}"; shift ;;
    -u|--user) REMOTE_USER="${2:-}"; shift 2 ;;
    --user=*) REMOTE_USER="${1#*=}"; shift ;;
    -r|--remote-port) REMOTE_PORT="${2:-}"; shift 2 ;;
    --remote-port=*) REMOTE_PORT="${1#*=}"; shift ;;
    --strict) STRICT=1; shift ;;
    --no-open) OPEN_BROWSER=0; shift ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数:$1(用 --help 查看用法)" ;;
  esac
done

[[ "$LOCAL_PORT" =~ ^[0-9]+$ ]] || die "本地端口必须是数字:$LOCAL_PORT"
[[ "$REMOTE_PORT" =~ ^[0-9]+$ ]] || die "远端端口必须是数字:$REMOTE_PORT"

FORWARD_SUFFIX=":127.0.0.1:${REMOTE_PORT} ${REMOTE_USER}@${REMOTE_HOST}"

# ---------- 工具:端口是否被占用 ----------
port_busy() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0 || return 1
  fi
  # 无 lsof 时退化用 nc 探测(能连上即视为被占)。
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 0 || return 1
  fi
  return 1
}

# 占用者描述(仅用于提示,失败不影响主流程)。
port_owner() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || { echo "未知进程"; return; }
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{printf "%s(pid %s)", $1, $2}' || echo "未知进程"
}

# 本脚本已起的隧道 pid(按完整转发规格匹配,避免误伤)。
tunnel_pids() {
  pgrep -f "ssh .*-L [0-9]+${FORWARD_SUFFIX}" 2>/dev/null || true
}

# 某端口上是否已是我们自己的隧道。
tunnel_pid_on_port() {
  local port="$1"
  pgrep -f "ssh .*-L ${port}${FORWARD_SUFFIX}" 2>/dev/null | head -1 || true
}

open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

# ---------- status ----------
if [[ "$ACTION" == "status" ]]; then
  found=0
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    found=1
    lp=$(ps -o command= -p "$pid" 2>/dev/null | grep -oE '\-L [0-9]+' | awk '{print $2}')
    info "隧道运行中:pid ${pid}  http://127.0.0.1:${lp}  ->  ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PORT}"
  done <<<"$(tunnel_pids)"
  [[ $found -eq 1 ]] || info "没有本脚本起的隧道(远端 ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PORT})"
  exit 0
fi

# ---------- stop ----------
if [[ "$ACTION" == "stop" ]]; then
  pids=$(tunnel_pids)
  if [[ -z "$pids" ]]; then
    info "没有可关闭的隧道"
    exit 0
  fi
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null && info "已关闭隧道 pid ${pid}"
  done <<<"$pids"
  exit 0
fi

# ---------- start ----------
command -v ssh >/dev/null 2>&1 || die "未找到 ssh 命令"

# 已有隧道指向同一远端:直接复用,不重复起。
existing=$(tunnel_pids | head -1)
if [[ -n "$existing" ]]; then
  lp=$(ps -o command= -p "$existing" 2>/dev/null | grep -oE '\-L [0-9]+' | awk '{print $2}')
  info "隧道已在运行(pid ${existing}):http://127.0.0.1:${lp}"
  [[ $OPEN_BROWSER -eq 1 ]] && open_url "http://127.0.0.1:${lp}"
  exit 0
fi

# 端口选择:被占则退避(--strict 时直接失败)。
PORT="$LOCAL_PORT"
if port_busy "$PORT"; then
  owner=$(port_owner "$PORT")
  if [[ $STRICT -eq 1 ]]; then
    die "本地端口 ${PORT} 已被 ${owner} 占用(--strict:不退避)"
  fi
  info "本地端口 ${PORT} 已被 ${owner} 占用,自动退避…"
  picked=""
  for ((i = 1; i <= MAX_PROBE; i++)); do
    cand=$((LOCAL_PORT + i))
    (( cand <= 65535 )) || break
    if ! port_busy "$cand"; then picked="$cand"; break; fi
  done
  [[ -n "$picked" ]] || die "从 ${LOCAL_PORT} 起连续探测 ${MAX_PROBE} 个端口均被占用,请用 -p 指定"
  PORT="$picked"
  info "改用本地端口 ${PORT}"
fi

info "正在建立隧道 → ${REMOTE_USER}@${REMOTE_HOST}(远端 DSH 端口 ${REMOTE_PORT})…"

# ExitOnForwardFailure:转发失败即退出,避免「连上但没有转发」的假象。
# BatchMode 不启用——首次可能需要输入密码或确认 host key。
if ! ssh -f -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "${PORT}:127.0.0.1:${REMOTE_PORT}" \
  "${REMOTE_USER}@${REMOTE_HOST}"; then
  die "隧道建立失败。排查:1) 远端是否开启「远程登录」;2) 公钥是否已用 ssh-copy-id 装好;3) ${REMOTE_HOST} 是否可达"
fi

# 确认转发真的通了(而不仅仅是 ssh 起来了)。
sleep 1
pid=$(tunnel_pid_on_port "$PORT")
[[ -n "$pid" ]] || die "隧道进程未找到,可能已退出"

URL="http://127.0.0.1:${PORT}"
if command -v curl >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL" || echo 000)
  if [[ "$code" == "200" ]]; then
    info "隧道就绪 ✓  ${URL}  (pid ${pid})"
  else
    info "隧道已建立(pid ${pid}),但 ${URL} 返回 HTTP ${code}"
    info "  提示:确认远端 DSH 正在运行且监听 ${REMOTE_PORT} 端口"
  fi
else
  info "隧道已建立 ✓  ${URL}  (pid ${pid})"
fi

info "  关闭:$(basename "$0") stop"
[[ $OPEN_BROWSER -eq 1 ]] && open_url "$URL"
exit 0
