#!/usr/bin/env bash
# ohmydsh/scripts/install.sh — 把仓库 bin/dsh 安装到 ~/.local/bin(幂等,可重跑)。
#
# 跨系统:macOS / Linux / WSL / Git Bash(bin/dsh 是 bash 脚本,Windows 原生 cmd/PowerShell 不支持)。
#
#   用法:
#     ./scripts/install.sh              安装(默认 ~/.local/bin,可重复执行覆盖更新)
#     DSH_BIN_DIR=/opt/bin ./scripts/install.sh   自定义安装目录
#     ./scripts/install.sh uninstall    卸载(删除符号链接)
#
# 特性:
#   - 自动定位仓库根,不依赖调用时所在目录(支持 ./scripts/install.sh、bash scripts/install.sh、经符号链接调用);
#   - 生成**相对符号链接**:仓库整体移动后命令依然可用,无需重装;
#   - 只动 ~/.local/bin/dsh 一个链接,不影响 ~/.dsh 物化产物;
#   - 若安装目录不在 PATH,打印各 shell 的配置提示。
set -euo pipefail

ACTION="${1:-install}"

# ---------- 定位仓库根:解析自身路径(含符号链接),不依赖 realpath ----------
resolve_path() {
  local p="$1" dir
  while [ -L "$p" ]; do
    dir="$(cd "$(dirname "$p")" && pwd)"
    p="$(readlink "$p")"
    [[ "$p" != /* ]] && p="$dir/$p"
  done
  cd "$(dirname "$p")" && pwd
}

SCRIPT_DIR="$(resolve_path "${BASH_SOURCE[0]}")"
REPO="$(dirname "$SCRIPT_DIR")"
TARGET="$REPO/bin/dsh"

# 从目录 $1 到路径 $2(均须绝对路径)的相对路径,纯 bash 实现
relpath() {
  local from="$1" to="$2"
  local -a f t up
  local i j out=""
  IFS='/' read -r -a f <<< "${from#/}"
  IFS='/' read -r -a t <<< "${to#/}"
  i=0
  while [ "$i" -lt "${#f[@]}" ] && [ "$i" -lt "${#t[@]}" ] && [ "${f[$i]}" = "${t[$i]}" ]; do
    i=$((i + 1))
  done
  for ((j = i; j < ${#f[@]}; j++)); do up+=(".."); done
  if [ "${#up[@]}" -gt 0 ]; then
    out="$(IFS='/'; printf '%s' "${up[*]}")"
  fi
  for ((j = i; j < ${#t[@]}; j++)); do
    out="${out:+$out/}${t[$j]}"
  done
  printf '%s' "${out:-.}"
}

BIN_DIR="${DSH_BIN_DIR:-$HOME/.local/bin}"
LINK="$BIN_DIR/dsh"

if [ ! -f "$TARGET" ]; then
  echo "error: 找不到 $TARGET,请在仓库目录内执行本脚本" >&2
  exit 1
fi

case "$ACTION" in
  install)
    mkdir -p "$BIN_DIR"
    REL="$(relpath "$BIN_DIR" "$TARGET")"
    ln -sfn "$REL" "$LINK"
    echo "OK  已安装: $LINK -> $REL"
    echo "    (符号链接,仓库移动后仍可用;重复执行可覆盖更新)"
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
      echo
      echo "WARN $BIN_DIR 不在当前 PATH,按你的 shell 配置一行(重开终端生效):"
      echo "  bash:     echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
      echo "  zsh:      echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    fi
    echo
    echo "完成。新终端里执行 dsh 即可(常用子命令见 README)。"
    ;;
  uninstall)
    if [ -L "$LINK" ] || [ -e "$LINK" ]; then
      rm -f "$LINK"
      echo "OK  已卸载: $LINK"
    else
      echo "未安装($LINK 不存在),无需处理"
    fi
    ;;
  *)
    echo "用法: $0 [install|uninstall]" >&2
    echo "环境变量 DSH_BIN_DIR 可自定义安装目录(默认 \$HOME/.local/bin)" >&2
    exit 2
    ;;
esac
