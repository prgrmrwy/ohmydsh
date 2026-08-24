#!/usr/bin/env bash
# ohmydsh/scripts/bootstrap.sh — clone 后初始化仓库:检查 Node 环境并安装依赖(幂等)。
#
# 环境准则:要求最低版本(node >= 22 / npm >= 10),不锁死精确版本;
# .nvmrc 里的版本只是推荐值,不匹配仅提示。
#
# 跨系统:macOS / Linux / WSL / Git Bash。
#
#   用法:
#     ./scripts/bootstrap.sh          初始化(依赖已装则跳过,可重复执行)
#     ./scripts/bootstrap.sh --force  强制重新 npm ci(依赖坏了时用)
#
# 之后:
#     ./scripts/install.sh   安装 dsh 命令到 ~/.local/bin
#     dsh build && dsh       物化配置并启动
set -euo pipefail

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# ---------- 定位仓库根(与 install.sh 同一套解析,支持符号链接调用) ----------
resolve_path() {
  local p="$1" dir
  while [ -L "$p" ]; do
    dir="$(cd "$(dirname "$p")" && pwd)"
    p="$(readlink "$p")"
    [[ "$p" != /* ]] && p="$dir/$p"
  done
  cd "$(dirname "$p")" && pwd
}

REPO="$(dirname "$(resolve_path "${BASH_SOURCE[0]}")")"
cd "$REPO"

# ---------- 1. 检查 Node / npm ----------
# 准则:只要求「不低于最低版本」,不锁死精确版本。
#   - 低于最低版本 -> 报错退出(仓库脚本/依赖确实跑不起来)
#   - 高于最低版本但与推荐版本不同 -> 仅提示,继续执行
MIN_NODE="22.0.0"
MIN_NPM="10.0.0"
RECOMMENDED_NODE="$( [ -f .nvmrc ] && tr -d ' \t\r\nv' < .nvmrc || echo "24.12.0" )"

# 纯 bash 版本比较:version_lt A B -> A < B 时返回 0
version_lt() {
  local a="${1%%-*}" b="${2%%-*}" i
  local -a x y
  IFS=. read -r -a x <<< "$a"
  IFS=. read -r -a y <<< "$b"
  for i in 0 1 2; do
    local xi="${x[i]:-0}" yi="${y[i]:-0}"
    xi="${xi//[!0-9]/}"; yi="${yi//[!0-9]/}"
    (( 10#${xi:-0} < 10#${yi:-0} )) && return 0
    (( 10#${xi:-0} > 10#${yi:-0} )) && return 1
  done
  return 1
}

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: 未找到 $tool,需要 Node.js >= $MIN_NODE + npm >= $MIN_NPM" >&2
    echo "  nvm:     nvm install && nvm use" >&2
    echo "  通用:    从 https://nodejs.org 下载安装" >&2
    exit 1
  fi
done

ACTUAL_NODE="$(node -v | sed 's/^v//')"
ACTUAL_NPM="$(npm -v)"

if version_lt "$ACTUAL_NODE" "$MIN_NODE"; then
  echo "error: Node.js 版本过低: v$ACTUAL_NODE(需要 >= $MIN_NODE,推荐 $RECOMMENDED_NODE)" >&2
  echo "  使用 nvm 时可运行: nvm install && nvm use" >&2
  exit 1
fi
if version_lt "$ACTUAL_NPM" "$MIN_NPM"; then
  echo "error: npm 版本过低: $ACTUAL_NPM(需要 >= $MIN_NPM)" >&2
  echo "  升级: npm install -g npm@latest" >&2
  exit 1
fi

echo "环境 OK: node v$ACTUAL_NODE / npm $ACTUAL_NPM(要求 node >= $MIN_NODE, npm >= $MIN_NPM)"
if [ "$ACTUAL_NODE" != "$RECOMMENDED_NODE" ]; then
  echo "提示: 推荐 Node $RECOMMENDED_NODE(.nvmrc);当前 v$ACTUAL_NODE 满足最低要求,继续执行。"
fi

# ---------- 2. 从根 lock 安装全部 workspace 依赖(幂等) ----------
if [ "$FORCE" -eq 1 ] || [ ! -f node_modules/js-yaml/package.json ] || [ ! -f node_modules/typescript/package.json ]; then
  echo "从根 package-lock 安装 workspace 依赖(npm ci)..."
  npm ci
else
  echo "根 workspace 依赖已就绪,跳过 npm ci(如遇依赖问题可 ./scripts/bootstrap.sh --force 重装)"
fi

echo "OK 初始化完成。下一步:"
echo "  ./scripts/install.sh    # 安装 dsh 命令到 ~/.local/bin"
echo "  dsh build && dsh        # 物化配置并启动"
