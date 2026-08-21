#!/usr/bin/env bash
# ohmydsh/scripts/bootstrap.sh — clone 后初始化仓库:检查 Node 环境并安装依赖(幂等)。
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
EXPECTED_NODE="24.12.0"
EXPECTED_NPM="11.6.2"
for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: 未找到 $tool,需要 Node.js $EXPECTED_NODE + npm $EXPECTED_NPM" >&2
    echo "  nvm:     nvm install && nvm use" >&2
    echo "  通用:    从 https://nodejs.org 下载安装" >&2
    exit 1
  fi
done

ACTUAL_NODE="$(node -v | sed 's/^v//')"
ACTUAL_NPM="$(npm -v)"
if [ "$ACTUAL_NODE" != "$EXPECTED_NODE" ] || [ "$ACTUAL_NPM" != "$EXPECTED_NPM" ]; then
  echo "error: 工具链版本不匹配: node $ACTUAL_NODE / npm $ACTUAL_NPM" >&2
  echo "  需要: node $EXPECTED_NODE / npm $EXPECTED_NPM" >&2
  echo "  使用 nvm 时可运行: nvm install && nvm use" >&2
  exit 1
fi
echo "环境 OK: node v$ACTUAL_NODE / npm $ACTUAL_NPM"

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
