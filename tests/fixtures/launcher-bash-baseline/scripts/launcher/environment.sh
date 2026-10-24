#!/usr/bin/env bash
# Temporary Bash migration baseline. Source only; invoke functions explicitly.

snapshot_launcher_environment() {
  # Local overrides (gitignored; optional). Snapshot DSH_BIN first so migration
  # of the old Pet-only .env.local value never swallows an identical value that
  # the caller deliberately exported for this invocation.
  CALLER_DSH_BIN_SET=0
  CALLER_DSH_BIN=""
  if [[ -n "${DSH_BIN+x}" ]]; then
    CALLER_DSH_BIN_SET=1
    CALLER_DSH_BIN="$DSH_BIN"
  fi
}

initialize_launcher_environment() {
  # The first Pet Locus deployment selected its generated Host runtime through the
  # process-wide DSH_BIN escape hatch. That also retargeted build/plugin commands
  # and could pin a stale official version forever. Migrate only the exact value
  # newly sourced from this checkout's .env.local; every caller-supplied DSH_BIN
  # keeps its original highest-priority meaning.
  LEGACY_PET_DSH_BIN="$REPO/packages/dsh-pet/compat/subagent/.launcher/node_modules/.bin/dsh"
  if [[ $CALLER_DSH_BIN_SET -eq 1 ]]; then
    DSH_BIN="$CALLER_DSH_BIN"
  elif [[ "${DSH_BIN:-}" == "$LEGACY_PET_DSH_BIN" ]]; then
    echo "info: 忽略 .env.local 中旧 dsh-pet DSH_BIN；Host runtime 现由 dsh.yaml 声明管理" >&2
    unset DSH_BIN
  fi

  # Snapshot the user's explicit registry override before this launcher runs any
  # npm operation of its own. bin/dsh is a bash script invoked straight from the
  # user's shell, so a value visible at this point normally can only come from
  # the user — inline env, an exported shell var, or .env.local (all deliberate).
  # npm/npx bake npm_config_* only into processes they spawn, never into their
  # caller. That is what lets start_server tell "user intent" apart from "npm
  # exec baked it in" when it strips the inherited npm environment (design D1).
  #
  # The exception is the launcher itself being run by a package manager
  # (`npm run dsh`, `npx ohmydsh`, …): then the entry environment is already
  # baked and the value is NOT user intent. npm sets npm_command for exactly
  # those invocations and never for a plain shell call, so it is a reliable
  # witness. Per spec, a source we cannot attribute to the user must be treated
  # as implicit and stripped — never passed off as intent.
  if [[ -n "${npm_command:-}" ]]; then
    DSH_USER_REGISTRY=""
  else
    DSH_USER_REGISTRY="${npm_config_registry:-${NPM_CONFIG_REGISTRY:-}}"
  fi

  DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
  PROFILE="${DSH_PROFILE:-web}"
  PROFILE_PKG="$DSH_HOME/profiles/$PROFILE/package.json"
  STARTUP_LOG="$DSH_HOME/dsh-startup.log"

  # Repo default registry: the committed repo .npmrc is the source for this
  # launcher's own npm work, so version detection (check-update.mjs → npmjs) and
  # installs use the same source. The repo and its lockfiles must not depend on
  # internal mirrors. Explicit npm_config_registry / NPM_CONFIG_REGISTRY /
  # .env.local still take precedence.
  #
  # This value is NOT exported: an exported npm_config_registry propagates down
  # the whole process tree (launcher → DSH server → agent shells) and, because
  # env beats every .npmrc, would silently retarget unrelated npm/pnpm/rush work
  # in other repositories. Injection is per-call via with_repo_registry instead
  # (design D1). NB: npm 11 honors the lowercase npm_config_* env form only.
  REPO_REGISTRY=""
  if [[ -f "$REPO/.npmrc" ]]; then
    REPO_REGISTRY="$(sed -n 's/^[[:space:]]*registry[[:space:]]*=[[:space:]]*"\{0,1\}\([^"[:space:]]*\)"\{0,1\}[[:space:]]*/\1/p' "$REPO/.npmrc" | head -1)"
  fi
}

# Run one command with the repo registry applied, scoped to that command only.
# A user-supplied override wins and is left untouched.
with_repo_registry() {
  if [[ -n "$REPO_REGISTRY" && -z "$DSH_USER_REGISTRY" ]]; then
    npm_config_registry="$REPO_REGISTRY" "$@"
  else
    "$@"
  fi
}

dsh_version() {
  grep -m1 '^dshVersion:' "$REPO/dsh.yaml" | sed -E 's/^dshVersion:[[:space:]]*"?([^"#[:space:]]+).*/\1/'
}

# npm/npx bake their resolved config into a batch of npm_* variables for every
# process they spawn. The DSH server is long-lived and hands its environment to
# every agent shell, so anything inherited here silently retargets the user's
# npm/pnpm/rush work in unrelated repositories — env outranks every .npmrc.
# Resolving the CLI and running it under node (see start_server) means npm never
# spawns the server, so these are not generated in the first place; stripping
# them is defence in depth for the case where the launcher itself was started
# from `npm run` and inherited a polluted environment.
#
# A registry the user set explicitly is restored afterwards by start_server:
# that is intent, not inherited noise (design D1/D3).
server_env_strip_args() {
  local name
  while IFS= read -r name; do
    [[ -n "$name" ]] && printf '%s\0' "-u$name"
  done < <(compgen -e | grep -E '^npm_(config_|lifecycle_|package_)|^npm_(command|execpath|node_execpath)$' || true)
}
