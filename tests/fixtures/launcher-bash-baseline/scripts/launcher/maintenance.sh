#!/usr/bin/env bash
# Temporary Bash migration baseline. Source only; invoke functions explicitly.

do_build() {
  with_repo_registry node "$REPO/scripts/sync.mjs"
}

# ---------- 本机运行前提:定制的 hostPrerequisites 自愈 ----------
# 这些前提是机器本地状态(bin/dsh 之外的全局安装),环境重建后必然缺失,而缺失
# 只表现为插件降级。启动前补一次;失败只告警 —— 装不上一个包不该让人起不来 DSH,
# 但必须留下可操作的诊断与日志,免得"以为治过了"。
record_prereq_event() {
  # 闸口跑在 prepare_server_runtime 之前,而后者才负责建 $DSH_HOME;首次启动时
  # 这里必须先建目录,否则重定向失败(set -e 下会直接中断启动)。
  mkdir -p "$DSH_HOME"
  printf '[%s] hostPrerequisites: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" >>"$STARTUP_LOG"
}

ensure_host_prerequisites() {
  local out="" status=0
  case "$(printf '%s' "${DSH_SKIP_HOST_PREREQUISITES:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      echo "本机运行前提:已按 DSH_SKIP_HOST_PREREQUISITES 跳过自愈"
      record_prereq_event "skipped (DSH_SKIP_HOST_PREREQUISITES)"
      return 0
      ;;
  esac
  out="$(with_repo_registry node "$REPO/scripts/host-prerequisites.mjs" 2>&1)" || status=$?
  [[ -n "$out" ]] && printf '%s\n' "$out"
  if [[ $status -eq 0 ]]; then
    # 只在真的装了什么时写日志,避免每次启动都留一行噪声。
    if [[ "$out" == *"已安装"* ]]; then
      record_prereq_event "installed: $(printf '%s\n' "$out" | grep '已安装' | tr '\n' ';')"
    fi
    return 0
  fi
  echo "warn: 本机运行前提未全部满足(见上,通常是没有网络或 registry 不可达)" >&2
  echo "warn: 这不影响启动;恢复网络后重跑 dsh doctor 即可" >&2
  record_prereq_event "failed (exit $status)"
  return 0
}

do_history() {
  if [[ -f "$STARTUP_LOG" ]]; then
    tail -n 20 "$STARTUP_LOG"
  else
    echo "no startup history yet (run dsh to start one)"
  fi
}

# Print the plugin list this profile would load / loaded, one per line, with a note
print_plugins() {
  local out
  out="$(node "$REPO/scripts/plugin-list.mjs" 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    echo "加载的 plugins:"
    echo "$out" | sed 's/^/  - /'
  else
    echo "加载的 plugins:(无法读取 profile 清单)"
  fi
}

# Append one startup record: timestamp, dsh version, port, loaded plugins
# 插件清单走 plugin-list.mjs --names(与启动 msg 同一真相源:bundle 层 +
# patch 层)。早先这里只读 dsh.profile.bundles,靠 patch insert 行接线的插件
# (如 dsh-width-tiers)既不出现在启动 msg 里,也不出现在历史记录里。
record_startup() {
  local VER="$1" runtime_kind="$2" runtime_owner="$3" runtime_compat="$4" runtime_fingerprint="$5" plugins=""
  plugins="$(node "$REPO/scripts/plugin-list.mjs" --names 2>/dev/null || true)"
  printf '[%s] dshVersion=%s runtime=%s owner=%s compat=%s fingerprint=%s port=%s plugins=[%s]\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$VER" "$runtime_kind" "$runtime_owner" "$runtime_compat" "$runtime_fingerprint" "$PORT" "$plugins" >>"$STARTUP_LOG"
}

# check-update.mjs 输出 JSON 解析进全局变量;解析失败回退 AU_STATUS=error(fail-open)
autoup_parse() {
  local out="$1" fields
  AUTOUP_ENABLED=0; AU_STATUS="error"; AU_CURRENT=""; AU_LATEST=""; AU_CHANNEL=""; AU_ERROR=""
  [[ "$out" != \{* ]] && { AU_ERROR="check-update 输出异常"; return 1; }
  fields="$(printf '%s' "$out" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const esc=(s)=>"\""+String(s??"").replace(/[\\"$`]/g,"\\$&")+"\"";
      const j=JSON.parse(d);
      console.log("AUTOUP_ENABLED="+(j.enabled?1:0));
      console.log("AU_STATUS="+esc(j.status));
      console.log("AU_CURRENT="+esc(j.current));
      console.log("AU_LATEST="+esc(j.latest));
      console.log("AU_CHANNEL="+esc(j.channel));
      console.log("AU_ERROR="+esc(j.error));
    })'
  )" && eval "$fields"
}

# 记录 autoUpdate 事件到启动日志(kind: upgrade|skip|offline)
record_autoup_event() {
  local kind="$1" msg
  case "$kind" in
    upgrade) msg="autoUpdate: $2 -> $3 (channel=$4)" ;;
    skip)    msg="autoUpdate: skip upgrade to $2 ($3)" ;;
    offline) msg="autoUpdate: offline ($3)" ;;
  esac
  printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$msg" >>"$STARTUP_LOG"
}

# 升级链:改写 dsh.yaml(含同族 pin)→ 重跑 sync → 自动 commit。任何失败即报错退出、不启动。
do_autoupgrade() {
  local rewrite_out
  echo "检测到新版本 $AU_CURRENT -> $AU_LATEST (channel=$AU_CHANNEL),开始自动升级..."
  rewrite_out="$(with_repo_registry node "$REPO/scripts/check-update.mjs" --rewrite-to "$AU_LATEST" 2>&1 || true)"
  if [[ "$rewrite_out" != *"wrote "* ]]; then
    echo "error: 自动改写 dsh.yaml 失败:" >&2
    echo "$rewrite_out" >&2
    exit 1
  fi
  printf '%s\n' "$rewrite_out" | sed -n 's/^rewrite: /  /p'
  if ! with_repo_registry node "$REPO/scripts/sync.mjs"; then
    echo "error: 升级后 sync 失败,从 dsh.yaml.bak 回滚 dsh.yaml" >&2
    cp "$REPO/dsh.yaml.bak" "$REPO/dsh.yaml"
    rm -f "$REPO/dsh.yaml.bak"
    exit 1
  fi
  if ! git -C "$REPO" add dsh.yaml || ! git -C "$REPO" commit --no-verify -m "chore(dsh): auto-bump $AU_CURRENT → $AU_LATEST" >/dev/null; then
    echo "error: 自动 commit 失败(dsh.yaml 已升级并完成 build)。处置:git commit dsh.yaml 保留,或 git checkout -- dsh.yaml 回滚" >&2
    exit 1
  fi
  rm -f "$REPO/dsh.yaml.bak"
  AUTOUP_UPDATED=1
  record_autoup_event upgrade "$AU_CURRENT" "$AU_LATEST" "$AU_CHANNEL"
  echo "DSH 已自动升级至 $AU_LATEST 并提交。"
}

# 检测 + 分支;始终返回 0(继续),升级链内部失败会直接 exit。
autoupdate() {
  local out
  out="$(with_repo_registry node "$REPO/scripts/check-update.mjs" 2>/dev/null || true)"
  if ! autoup_parse "$out"; then
    # 脚本本身不可用(空输出/非 JSON):fail-open,但显式警告,不静默吞掉
    echo "warn: 版本检测不可用($AU_ERROR),按当前版本继续"
    return 0
  fi
  if [[ $AUTOUP_ENABLED -ne 1 ]]; then return 0; fi
  case "$AU_STATUS" in
    update)
      if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
        echo "检测到新版本 $AU_LATEST,但仓库有未提交改动,已跳过自动更新(提交后下次启动自动升级)"
        record_autoup_event skip "$AU_LATEST" "dirty-worktree"
        return 0
      fi
      do_autoupgrade
      ;;
    offline)
      echo "warn: 版本检测失败($AU_ERROR),按当前版本继续"
      record_autoup_event offline "" "$AU_ERROR"
      ;;
    no-update) : ;;
    *)
      echo "warn: 版本检测不可用($AU_ERROR),按当前版本继续"
      ;;
  esac
  return 0
}
