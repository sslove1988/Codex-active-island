#!/bin/sh
set -eu

provider="${1:-}"
phase="${2:-}"
task_id="${3:-}"

case "$provider" in codex|claudeCode) ;; *) exit 2 ;; esac
case "$phase" in idle|running|completed|failed) ;; *) exit 2 ;; esac

status_dir="${FOCUSD_AGENT_STATUS_DIR:-$HOME/Library/Application Support/com.focusd.island}"
status_path="${FOCUSD_AGENT_STATUS_PATH:-$status_dir/agent-status.json}"
mkdir -p "$status_dir"

now="$(($(date +%s) * 1000))"
task_field=""
if [ -n "$task_id" ]; then
  task_field=",\"taskId\":\"$task_id\""
fi

idle="{\"phase\":\"idle\",\"updatedAt\":$now}"
current="{\"phase\":\"$phase\",\"updatedAt\":$now$task_field}"
if [ "$provider" = "codex" ]; then
  json="{\"codex\":$current,\"claudeCode\":$idle,\"updatedAt\":$now}"
  marker="agent-codex-running.flag"
  hold="agent-codex-running-hold.flag"
else
  json="{\"codex\":$idle,\"claudeCode\":$current,\"updatedAt\":$now}"
  marker="agent-claudeCode-running.flag"
  hold="agent-claudeCode-running-hold.flag"
fi

temporary="$status_path.tmp"
printf '%s\n' "$json" > "$temporary"
mv -f "$temporary" "$status_path"

if [ "$phase" = "running" ]; then
  : > "$status_dir/$marker"
else
  rm -f "$status_dir/$marker" "$status_dir/$hold"
fi
