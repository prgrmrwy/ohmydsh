#!/usr/bin/env bash
# Temporary Bash migration baseline. Source only; invoke functions explicitly.

initialize_launcher_args() {
  PORT=3080
  BUILD=0
  BUILD_ONLY=0
  STOP=0
  RESTART=0
  NO_OPEN=0
  OPEN=0
  RESET=0
  FOREGROUND=0
  HISTORY=0
  PLUGIN_UPDATE=0
  DOCTOR=0
  CHECK_ONLY=0
  DRY_RUN=""
  YES_FLAG=""
  PASSTHRU=()
}

usage() {
  sed -n '2,20p' "$SOURCE" | sed 's/^# \{0,1\}//'
  exit 0
}

# ---------- 官方 CLI 直通 ----------
# `dsh` 这个名字同时是本启动器与官方 @deepseek-ai/dsh CLI 的入口,而用户 PATH
# 里通常只有 ~/.local/bin/dsh(本启动器)。官方 CLI 的调用形式若落到这里,旧实现
# 会把不认识的参数塞进 PASSTHRU 拼到 `dsh web` 之后 —— 但 web 子命令没有
# --profile,于是冷启动直接死在 `error: unknown option '--profile'`。
#
# 因此在解析自己的参数之前先判定:这次调用属于官方 CLI 吗?属于就原样转交,
# 让 `dsh plugin --profile web add <pkg>`、`dsh --dump-config` 等按官方语义工作。
# 判定只认官方独有的顶层选项与 plugin 子命令,不会截走启动器自己的命令
# (注意 plugin-update 是本仓库命令,与官方 plugin 精确区分)。
is_official_cli_invocation() {
  local first_positional="" a
  for a in "$@"; do
    case "$a" in
      # 官方顶层独有选项:启动器没有同名参数,出现即代表调用官方 CLI
      --profile|--profile=*|--patch|--patch=*|--dump-config|--dump-default-config) return 0 ;;
    esac
    if [[ -z "$first_positional" && "$a" != -* ]]; then first_positional="$a"; fi
  done
  # 官方子命令(精确匹配,避免误吞本仓库的 plugin-update)
  [[ "$first_positional" == "plugin" ]]
}

parse_launcher_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      build) BUILD_ONLY=1; shift ;;
      # 官方 `dsh web` = 启动 web profile,语义与本启动器默认行为一致。吸收掉它,
      # 否则会被当作未知参数透传成 `dsh web --port N web`(多余位置参数 → 报错)。
      web) shift ;;
      stop) STOP=1; shift ;;
      restart) RESTART=1; shift ;;
      reset) RESET=1; shift ;;
      history) HISTORY=1; shift ;;
      plugin-update) PLUGIN_UPDATE=1; shift ;;
      doctor) DOCTOR=1; shift ;;
      --check) CHECK_ONLY=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      -y|--yes) YES_FLAG=1; shift ;;
      -b|--build) BUILD=1; shift ;;
      -d|--daemon) shift ;;        # 兼容保留:默认即非阻塞后台
      --foreground) FOREGROUND=1; shift ;;
      --open) OPEN=1; shift ;;
      --no-open) NO_OPEN=1; shift ;;
      -p|--port) PORT="$2"; shift 2 ;;
      --port=*) PORT="${1#*=}"; shift ;;
      -h|--help) usage ;;
      # 官方 web app 自己的参数:原样透传给 `dsh web`(--host 会覆盖 LAN 绑定)。
      --host|--trusted-host) PASSTHRU+=("$1" "$2"); shift 2 ;;
      --host=*|--trusted-host=*) PASSTHRU+=("$1"); shift ;;
      # 其余一律拒绝。旧实现静默透传,拼错的参数会被拼到 `dsh web` 之后,
      # 让服务冷启动直接失败(且错误只出现在 dsh.log 里,极难定位)。
      *)
        echo "error: 无法识别的参数 '$1'" >&2
        echo "       启动器参数见 dsh --help;官方 web 参数仅支持 --host/--port/--no-open/--trusted-host" >&2
        echo "       官方 CLI 命令(plugin/--profile/--dump-config)会自动转交,无需手动处理" >&2
        exit 1
        ;;
    esac
  done
}

validate_launcher_args() {
  # --check 只对 doctor 有意义;单独使用时明确报错,而不是被静默忽略。
  if [[ $CHECK_ONLY -eq 1 && $DOCTOR -ne 1 ]]; then
    echo "error: --check 只能与 doctor 一起使用(dsh doctor --check)" >&2
    exit 1
  fi
  return 0
}
