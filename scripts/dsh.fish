# dsh launcher functions for the zydsh extension workspace.
#
# Install: add one line to ~/.config/fish/config.fish
#   source /Users/bytedance/mydir/opensource/zydsh/scripts/dsh.fish
#
# Then:
#   dsh         # foreground web server on the pinned version
#   dsh-up      # background + open http://127.0.0.1:3080
#   dsh-down    # stop the running dsh web process
#   dsh-sync    # materialize dsh.yaml customizations into ~/.dsh
#
# Version is pinned so npx cannot silently drift to a newer rc.
# Bump DSH_VERSION here when you intentionally upgrade (sync warns on mismatch with dsh.yaml).

set -g DSH_VERSION 0.1.0-rc.6
set -g DSH_PORT 3080

function dsh
    npx -y @deepseek-ai/dsh@$DSH_VERSION web --port $DSH_PORT $argv
end

function dsh-up
    npx -y @deepseek-ai/dsh@$DSH_VERSION web --port $DSH_PORT >>$HOME/.dsh/dsh.log 2>&1 &
    open http://127.0.0.1:$DSH_PORT
end

function dsh-down
    pkill -f '\.bin/dsh web'; or echo 'no dsh process found'
end

function dsh-sync
    node /Users/bytedance/mydir/opensource/zydsh/scripts/sync.mjs
end
