#!/usr/bin/env bash
# schedule.sh — headless runner and launchd installer for /seo-agent:run
#
#   schedule.sh run <product-dir> [--max-sessions N] [--dry-run] [-- <args for run>]
#   schedule.sh install <product-dir> [--at HH:MM] [--days 1-5] [--print]
#   schedule.sh kick <product-dir>        fire the installed job now through launchd (a real run)
#   schedule.sh uninstall <product-dir>
#   schedule.sh status [<product-dir>]
#   schedule.sh log <product-dir> [lines]
#   schedule.sh env
#
# `run` = one firing: fetch, require a clean tree on the default branch, then
# call `claude -p "/seo-agent:run"` in a fresh session, up to N times, as long as
# the run ends with `next: again` (it opened/revised/labelled a PR that the next
# session must review or revise). Stops on `next: tomorrow`, an error, the cap, or
# a weekend. Logs to ~/Library/Logs/seo-agent/<product>-<date>.log and posts a
# macOS notification with the `did:` line. Idempotent by construction: the run
# skill's ledger is git, so a second firing the same day repeats nothing.
#
# Permissions: unattended sessions run with the least-privilege allowlist in
# templates/runner-settings.json (git, gh, node, php artisan, read-only shell
# tools, file edits; no rm, no force-push). A tool outside the list is denied and
# the run reports it instead of hanging. Edit that file to widen or narrow it.
#
# Environment (all optional):
#   SEO_AGENT_ENV              file sourced before running (secrets, proxy); default ~/.config/seo-agent/env
#   SEO_AGENT_LOG_DIR          default ~/Library/Logs/seo-agent
#   SEO_AGENT_MAX_SESSIONS     default 4 (execute → review → revise → review)
#   SEO_AGENT_SESSION_TIMEOUT  seconds per session, default 5400
#   SEO_AGENT_CLAUDE           claude binary, default `claude`
#   SEO_AGENT_CLAUDE_FLAGS     default `--settings <plugin>/templates/runner-settings.json`
#   SEO_AGENT_NOTIFY           1 (default) posts a macOS notification when osascript exists; 0 disables
#   SEO_AGENT_QUIET            1 = log to file only (the launchd plist sets it); default also prints
#   SEO_AGENT_DOW              1–7 override of today's weekday (tests)
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SEO_AGENT_ENV:-$HOME/.config/seo-agent/env}"
LOG_DIR="${SEO_AGENT_LOG_DIR:-$HOME/Library/Logs/seo-agent}"
MAX_SESSIONS="${SEO_AGENT_MAX_SESSIONS:-4}"
SESSION_TIMEOUT="${SEO_AGENT_SESSION_TIMEOUT:-5400}"
CLAUDE_BIN="${SEO_AGENT_CLAUDE:-claude}"
CLAUDE_FLAGS="${SEO_AGENT_CLAUDE_FLAGS:---settings $PLUGIN_DIR/templates/runner-settings.json}"
NOTIFY="${SEO_AGENT_NOTIFY:-1}"
QUIET="${SEO_AGENT_QUIET:-0}"

LOG=""; LOCK=""
say() {  # timestamped line → log (+ stdout unless quiet)
  local line; line="$(date '+%F %T') $*"
  [ -n "$LOG" ] && printf '%s\n' "$line" >>"$LOG"
  [ "$QUIET" = 1 ] || printf '%s\n' "$line"
}
emit() {  # raw block → log (+ stdout unless quiet)
  [ -n "$LOG" ] && printf '%s\n' "$1" >>"$LOG"
  [ "$QUIET" = 1 ] || printf '%s\n' "$1"
}
notify() {  # title, body
  [ "$NOTIFY" = 1 ] || return 0
  command -v osascript >/dev/null 2>&1 || return 0
  local t b; t=${1//\"/\'}; b=${2//\"/\'}; b=${b//\\/}
  osascript -e "display notification \"${b:0:200}\" with title \"${t:0:60}\"" >/dev/null 2>&1 || true
}
usage() { sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

product_name() { basename "$1"; }
label_for() { echo "com.seo-agent.$(product_name "$1")"; }
plist_for() { echo "$HOME/Library/LaunchAgents/$(label_for "$1").plist"; }

load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a; # shellcheck disable=SC1090
    . "$ENV_FILE"; set +a
  fi
}

default_branch() {
  local b
  b=$(git -C "$1" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
  if [ -z "$b" ]; then
    if git -C "$1" show-ref -q --verify refs/heads/main; then b=main; else b=master; fi
  fi
  echo "$b"
}

# ---------------------------------------------------------------- run
cmd_run() {
  local product="" max="$MAX_SESSIONS" dry=0 extra=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --max-sessions) max="$2"; shift 2 ;;
      --dry-run) dry=1; shift ;;
      --) shift; extra=("$@"); break ;;
      -h|--help) usage ;;
      -*) extra+=("$1"); shift ;;
      *) if [ -z "$product" ]; then product="$1"; else extra+=("$1"); fi; shift ;;
    esac
  done
  [ -n "$product" ] || { echo "run: product directory required" >&2; usage 2; }
  product="$(cd "$product" 2>/dev/null && pwd)" || { echo "run: no such directory" >&2; exit 2; }
  local name; name="$(product_name "$product")"
  mkdir -p "$LOG_DIR"
  LOG="$LOG_DIR/$name-$(date +%F).log"
  load_env

  local dow="${SEO_AGENT_DOW:-$(date +%u)}"
  local forced=0 a
  for a in "${extra[@]+"${extra[@]}"}"; do [ "$a" = "--as" ] && forced=1; done
  if [ "$dow" -gt 5 ] && [ "$forced" = 0 ]; then
    say "weekend — nothing scheduled ($name)"; return 0
  fi

  LOCK="$LOG_DIR/$name.lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    say "another run is in progress ($LOCK exists) — skipping"; return 0
  fi
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT

  say "=== firing: $name (plugin $PLUGIN_DIR, max $max sessions)"

  # repo state: network, clean tree, default branch, up to date
  if ! git -C "$product" fetch -q origin 2>>"$LOG"; then
    say "abort: git fetch failed (offline?)"; notify "seo-agent · $name" "abort: git fetch failed"; return 4
  fi
  if [ -n "$(git -C "$product" status --porcelain)" ]; then
    say "abort: working tree is dirty — commit or stash first"; notify "seo-agent · $name" "abort: dirty working tree"; return 3
  fi
  local def cur; def="$(default_branch "$product")"; cur="$(git -C "$product" branch --show-current)"
  if [ "$cur" != "$def" ]; then
    say "switching $cur → $def"
    git -C "$product" checkout -q "$def" 2>>"$LOG" || { say "abort: cannot check out $def"; return 3; }
  fi
  if ! git -C "$product" pull -q --ff-only origin "$def" 2>>"$LOG"; then
    say "abort: $def is not fast-forwardable to origin/$def"; notify "seo-agent · $name" "abort: $def diverged from origin"; return 3
  fi

  local prompt="/seo-agent:run" i=1 rc=0 did="" text="" meta="" parsed="" out="" again=0
  [ "$dry" = 1 ] && { prompt="$prompt --dry-run"; max=1; }
  [ ${#extra[@]} -gt 0 ] && prompt="$prompt ${extra[*]}"

  while [ "$i" -le "$max" ]; do
    say "--- session $i/$max: $prompt"
    # shellcheck disable=SC2086
    out=$(cd "$product" && perl -e 'alarm shift; exec @ARGV' "$SESSION_TIMEOUT" \
          "$CLAUDE_BIN" -p "$prompt" --plugin-dir "$PLUGIN_DIR" $CLAUDE_FLAGS --output-format json 2>&1); rc=$?
    parsed=$(printf '%s' "$out" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        let j=null;try{j=JSON.parse(s)}catch(e){}
        if(Array.isArray(j))j=j.find(x=>x&&x.type==="result")||null;
        let text=s,err=0,turns="",cost="",sid="";
        if(j&&typeof j==="object"){text=typeof j.result==="string"?j.result:JSON.stringify(j);err=j.is_error?1:0;turns=j.num_turns??"";cost=j.total_cost_usd??"";sid=j.session_id??""}
        process.stdout.write((text.endsWith("\n")?text:text+"\n")+`__meta is_error=${err} turns=${turns} cost=${cost} session=${sid}\n`)})')
    meta=$(printf '%s\n' "$parsed" | grep '^__meta ' | tail -1)
    text=$(printf '%s\n' "$parsed" | grep -v '^__meta ')
    emit "$text"
    say "--- end session $i (exit $rc; ${meta#__meta })"
    if [ "$rc" -ne 0 ] || [[ "$meta" == *"is_error=1"* ]]; then
      say "stop: session failed"; notify "seo-agent · $name" "session $i failed (exit $rc) — see $LOG"; return 1
    fi
    did=$(printf '%s\n' "$text" | grep -m1 -E '(^|[*_ ])did:' | sed 's/^[*_ ]*//' || true)
    [ -n "$did" ] && say "$did"
    if printf '%s\n' "$text" | grep -q -E '^\**next:\** *again'; then again=1; else again=0; fi
    [ "$again" = 1 ] || break
    i=$((i+1))
  done

  if [ "$again" = 1 ]; then
    say "stop: session cap ($max) reached with work still queued — run again or raise --max-sessions"
  fi
  local you; you=$(printf '%s\n' "$text" | grep -c -E 'gh pr merge|Deploy|deploy' || true)
  local body="${did:-done}"; [ "$you" -gt 0 ] && body="$body · action needed (see log)"
  notify "seo-agent · $name" "$body"
  say "=== done: $i session(s); log $LOG"
  return 0
}

# ---------------------------------------------------------------- install
cmd_install() {
  local product="" at="07:00" days="1-5" print=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --at) at="$2"; shift 2 ;;
      --days) days="$2"; shift 2 ;;
      --print) print=1; shift ;;
      -h|--help) usage ;;
      *) product="$1"; shift ;;
    esac
  done
  [ -n "$product" ] || { echo "install: product directory required" >&2; usage 2; }
  product="$(cd "$product" && pwd)" || exit 2
  local name label plist hour minute dlist=() d
  name="$(product_name "$product")"; label="$(label_for "$product")"; plist="$(plist_for "$product")"
  hour=$((10#${at%%:*})); minute=$((10#${at##*:}))
  if [[ "$days" == *-* ]]; then
    for ((d=${days%%-*}; d<=${days##*-}; d++)); do dlist+=("$d"); done
  else
    IFS=, read -r -a dlist <<<"$days"
  fi
  mkdir -p "$LOG_DIR"
  local cal="" envfile=""
  for d in "${dlist[@]}"; do
    cal+="      <dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
"
  done
  [ -n "${SEO_AGENT_ENV:-}" ] && envfile="      <key>SEO_AGENT_ENV</key><string>$SEO_AGENT_ENV</string>
"
  local content
  content=$(cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PLUGIN_DIR/scripts/schedule.sh</string>
    <string>run</string>
    <string>$product</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
$cal  </array>
  <key>EnvironmentVariables</key>
  <dict>
      <key>PATH</key><string>$PATH</string>
      <key>HOME</key><string>$HOME</string>
      <key>LANG</key><string>en_US.UTF-8</string>
      <key>SEO_AGENT_QUIET</key><string>1</string>
$envfile  </dict>
  <key>WorkingDirectory</key><string>$product</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/$name-launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST
)
  if [ "$print" = 1 ]; then printf '%s\n' "$content"; return 0; fi
  mkdir -p "$HOME/Library/LaunchAgents"
  printf '%s\n' "$content" >"$plist"
  plutil -lint "$plist" >/dev/null || { echo "install: invalid plist written to $plist" >&2; exit 1; }
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist" || { echo "install: launchctl bootstrap failed" >&2; exit 1; }
  launchctl enable "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  echo "installed $label: weekdays ${days} at $at → $plist"
  echo "env file: $ENV_FILE $([ -f "$ENV_FILE" ] && echo '(present)' || echo '(MISSING — run: schedule.sh env)')"
  echo "logs: $LOG_DIR/$name-<date>.log · test now: $0 run $product --dry-run"
}

cmd_kick() {
  local product="${1:-}"; [ -n "$product" ] || { echo "kick: product directory required" >&2; exit 2; }
  product="$(cd "$product" && pwd)" || exit 2
  local label; label="$(label_for "$product")"
  [ -f "$(plist_for "$product")" ] || { echo "kick: $label is not installed" >&2; exit 1; }
  launchctl kickstart "gui/$(id -u)/$label" && echo "started $label via launchd — follow with: $0 log $product"
}

cmd_uninstall() {
  local product="${1:-}"; [ -n "$product" ] || { echo "uninstall: product directory required" >&2; exit 2; }
  product="$(cd "$product" && pwd)" || exit 2
  local label plist; label="$(label_for "$product")"; plist="$(plist_for "$product")"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  rm -f "$plist"
  echo "removed $label"
}

cmd_status() {
  local product="${1:-}"
  if [ -z "$product" ]; then
    ls "$HOME/Library/LaunchAgents"/com.seo-agent.*.plist 2>/dev/null || echo "no seo-agent jobs installed"
    return 0
  fi
  product="$(cd "$product" && pwd)" || exit 2
  local label name; label="$(label_for "$product")"; name="$(product_name "$product")"
  if [ -f "$(plist_for "$product")" ]; then
    echo "$label: installed ($(plist_for "$product"))"
    launchctl print "gui/$(id -u)/$label" 2>/dev/null | grep -E 'state =|last exit code|program =' | sed 's/^/  /'
    grep -o '<integer>[0-9]*</integer><key>Hour</key><integer>[0-9]*</integer><key>Minute</key><integer>[0-9]*</integer>' "$(plist_for "$product")" \
      | sed -E 's#<integer>([0-9]+)</integer><key>Hour</key><integer>([0-9]+)</integer><key>Minute</key><integer>([0-9]+)</integer>#  weekday \1 at \2:\3#' | head -7
  else
    echo "$label: not installed"
  fi
  echo "env file: $ENV_FILE $([ -f "$ENV_FILE" ] && echo '(present)' || echo '(missing)')"
  local last; last=$(ls -t "$LOG_DIR/$name"-20*.log 2>/dev/null | head -1)
  if [ -n "$last" ]; then echo "last log: $last"; grep -E '=== |did:|stop:|abort:' "$last" | tail -6 | sed 's/^/  /'; else echo "no runs logged yet"; fi
}

cmd_log() {
  local product="${1:-}"; [ -n "$product" ] || { echo "log: product directory required" >&2; exit 2; }
  local name last; name="$(product_name "$(cd "$product" && pwd)")"
  last=$(ls -t "$LOG_DIR/$name"-20*.log 2>/dev/null | head -1)
  [ -n "$last" ] || { echo "no logs for $name in $LOG_DIR"; exit 1; }
  tail -n "${2:-60}" "$last"
}

cmd_env() {
  if [ -f "$ENV_FILE" ]; then echo "env file exists: $ENV_FILE"; return 0; fi
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$PLUGIN_DIR/templates/env.example" "$ENV_FILE" && chmod 600 "$ENV_FILE"
  echo "created $ENV_FILE (mode 600) — fill in the values, keep it out of every repo"
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  install) shift; cmd_install "$@" ;;
  kick) shift; cmd_kick "$@" ;;
  uninstall) shift; cmd_uninstall "$@" ;;
  status) shift; cmd_status "$@" ;;
  log) shift; cmd_log "$@" ;;
  env) shift; cmd_env "$@" ;;
  -h|--help|help|"") usage ;;
  *) echo "unknown command: $1" >&2; usage 2 ;;
esac
