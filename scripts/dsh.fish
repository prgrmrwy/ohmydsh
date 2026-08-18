# mydsh — fish 集成(可选)
#
# 主入口是仓库 bin/dsh(bash & fish 通用,经 ~/.local/bin/dsh 符号链接在 PATH 上)。
# 本文件只为旧习惯保留别名,可在 ~/.config/fish/config.fish 中 source:
#   source /Users/bytedance/mydir/opensource/mydsh/scripts/dsh.fish

alias dsh-up 'dsh -d'
alias dsh-down 'dsh stop'
alias dsh-sync 'dsh build'
