#!/usr/bin/env bash
# mydsh/scripts/bootstrap.sh — clone 后初始化仓库:检查 Node 环境并安装依赖(幂等)。
#
# 跨系统:macOS / Linux / WSL / Git Bash。
#
#   用法:
#     ./scripts/bootstrap.sh          初始化(依赖已装则跳过,可重复执行)
#     ./scripts/bootstrap.sh --force  强制重新 npm install(依赖坏了时用)
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
for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: 未找到 $tool,请先安装 Node.js ≥ 16" >&2
    echo "  macOS:   brew install node" >&2
    echo "  Linux:   用发行版包管理器安装 nodejs / npm" >&2
    echo "  通用:    从 https://nodejs.org 下载安装" >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 16 ]; then
  echo "error: Node.js 版本过低(node -v = $(node -v)),需要 ≥ 16" >&2
  exit 1
fi
echo "环境 OK: node $(node -v) / npm $(npm -v)"

# ---------- 2. 安装依赖(幂等) ----------
if [ "$FORCE" -eq 1 ] || [ ! -f node_modules/js-yaml/package.json ]; then
  echo "安装依赖(npm install)..."
  npm install
else
  echo "依赖已就绪,跳过 npm install(如遇依赖问题可 ./scripts/bootstrap.sh --force 重装)"
fi

echo "OK 初始化完成。下一步:"
echo "  ./scripts/install.sh    # 安装 dsh 命令到 ~/.local/bin"
echo "  dsh build && dsh        # 物化配置并启动"
