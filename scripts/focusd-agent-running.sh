#!/bin/sh
set -eu

provider="${1:-}"
case "$provider" in
  codex)
    marker="agent-codex-running.flag"
    hold="agent-codex-running-hold.flag"
    ;;
  claudeCode)
    marker="agent-claudeCode-running.flag"
    hold="agent-claudeCode-running-hold.flag"
    ;;
  *) exit 2 ;;
esac

status_dir="${FOCUSD_AGENT_STATUS_DIR:-$HOME/Library/Application Support/com.focusd.island}"
mkdir -p "$status_dir"
: > "$status_dir/$marker"
rm -f "$status_dir/$hold"
