#!/usr/bin/env bash
# Exercises scripts/schedule.sh without a real claude: loop/stop markers, failure, lock,
# weekend, dirty tree, branch switch, and plist generation.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; S="$HERE/../../scripts/schedule.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export SEO_AGENT_LOG_DIR="$T/logs" SEO_AGENT_NOTIFY=0 SEO_AGENT_ENV="$T/none" SEO_AGENT_CLAUDE="$HERE/fake-claude" FAKE_STATE="$T/state" SEO_AGENT_DOW=2
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/product" 2>/dev/null
( cd "$T/product" && git checkout -q -b main && git commit -q --allow-empty -m init && git push -q -u origin main 2>/dev/null )
git -C "$T/origin.git" symbolic-ref HEAD refs/heads/main
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok   $1"; }
bad() { fail=$((fail+1)); echo "  FAIL $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

echo "1. two sessions: again → tomorrow"
rm -f "$FAKE_STATE" "$FAKE_STATE.args"
out=$("$S" run "$T/product"); rc=$?
check "exit 0" '[ "$rc" = 0 ]'
check "fake claude called twice" '[ "$(cat "$FAKE_STATE")" = 2 ]'
check "prompt is /seo-agent:run with plugin dir and settings" 'grep -q -- "-p /seo-agent:run --plugin-dir .* --settings .*runner-settings.json --output-format json" "$FAKE_STATE.args"'
log="$SEO_AGENT_LOG_DIR/product-$(date +%F).log"
check "log written" '[ -f "$log" ]'
check "did lines logged" '[ "$(grep -c "did:" "$log")" -ge 2 ]'
check "done line" 'grep -q "=== done: 2 session" "$log"'

echo "2. failure stops with exit 1"
rm -f "$FAKE_STATE"; out=$(FAKE_FAIL=1 "$S" run "$T/product" 2>&1) && rc=0 || rc=$?
check "exit 1" '[ "$rc" = 1 ]'
check "one call only" '[ "$(cat "$FAKE_STATE")" = 1 ]'

echo "3. session cap"
rm -f "$FAKE_STATE"; out=$("$S" run "$T/product" --max-sessions 1)
check "stops at cap with note" 'printf "%s" "$out" | grep -q "session cap (1) reached"'

echo "4. dry run passes --dry-run and runs once"
rm -f "$FAKE_STATE" "$FAKE_STATE.args"; "$S" run "$T/product" --dry-run >/dev/null
check "prompt has --dry-run" 'grep -q -- "/seo-agent:run --dry-run" "$FAKE_STATE.args"'
check "one call" '[ "$(cat "$FAKE_STATE")" = 1 ]'

echo "5. extra args pass through"
rm -f "$FAKE_STATE" "$FAKE_STATE.args"; "$S" run "$T/product" -- --as fri --item B-003 >/dev/null
check "prompt carries --as fri --item B-003" 'grep -q -- "/seo-agent:run --as fri --item B-003" "$FAKE_STATE.args"'

echo "6. weekend skip unless --as"
rm -f "$FAKE_STATE"; out=$(SEO_AGENT_DOW=6 "$S" run "$T/product")
check "weekend message, no call" 'printf "%s" "$out" | grep -q weekend && [ ! -f "$FAKE_STATE" ]'
out=$(SEO_AGENT_DOW=6 "$S" run "$T/product" -- --as fri)
check "--as fri runs on a weekend" '[ -f "$FAKE_STATE" ]'

echo "7. lock"
mkdir "$SEO_AGENT_LOG_DIR/product.lock"; rm -f "$FAKE_STATE"
out=$("$S" run "$T/product"); rmdir "$SEO_AGENT_LOG_DIR/product.lock"
check "skips while locked" 'printf "%s" "$out" | grep -q "another run is in progress" && [ ! -f "$FAKE_STATE" ]'

echo "8. dirty tree aborts (exit 3)"
touch "$T/product/dirty"; out=$("$S" run "$T/product" 2>&1) && rc=0 || rc=$?; rm "$T/product/dirty"
check "exit 3" '[ "$rc" = 3 ]'
check "lock released" '[ ! -d "$SEO_AGENT_LOG_DIR/product.lock" ]'

echo "9. switches to the default branch"
git -C "$T/product" checkout -q -b production; rm -f "$FAKE_STATE"
"$S" run "$T/product" >/dev/null
check "back on main" '[ "$(git -C "$T/product" branch --show-current)" = main ]'

echo "10. install --print"
out=$(HOME="$T/home" "$S" install "$T/product" --at 06:30 --print)
check "label" 'printf "%s" "$out" | grep -q "<string>com.seo-agent.product</string>"'
check "five weekdays at 6:30" '[ "$(printf "%s" "$out" | grep -c "<key>Hour</key><integer>6</integer><key>Minute</key><integer>30</integer>")" = 5 ]'
check "runs schedule.sh run <product>" 'printf "%s" "$out" | grep -q "<string>$T/product</string>"'
printf '%s' "$out" >"$T/x.plist"
if command -v plutil >/dev/null; then check "plutil lint" 'plutil -lint "$T/x.plist" >/dev/null'; fi
out=$(HOME="$T/home" "$S" install "$T/product" --days 1,3,5 --print)
check "--days 1,3,5" '[ "$(printf "%s" "$out" | grep -c "<key>Weekday</key>")" = 3 ]'

echo "10b. install --quarterly --print and run --skill"
out=$(HOME="$T/home" "$S" install "$T/product" --quarterly --at 06:15 --print)
check "audit label" 'printf "%s" "$out" | grep -q "<string>com.seo-agent.product.audit</string>"'
check "four months on day 1" '[ "$(printf "%s" "$out" | grep -c "<key>Month</key>")" = 4 ] && printf "%s" "$out" | grep -q "<key>Day</key><integer>1</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>15</integer>"'
check "passes --skill audit" 'printf "%s" "$out" | grep -q "<string>--skill</string>" && printf "%s" "$out" | grep -q "<string>audit</string>"'
rm -f "$FAKE_STATE" "$FAKE_STATE.args"; "$S" run "$T/product" --skill audit >/dev/null
check "audit prompt, single session" 'grep -q -- "-p /seo-agent:audit " "$FAKE_STATE.args" && [ "$(cat "$FAKE_STATE")" = 1 ]'
out=$(SEO_AGENT_DOW=6 "$S" run "$T/product" --skill audit); check "audit ignores the weekend rule" '! printf "%s" "$out" | grep -q weekend'

echo "11. env creates the file with mode 600"
SEO_AGENT_ENV="$T/cfg/env" "$S" env >/dev/null
check "env file" '[ -f "$T/cfg/env" ] && [ "$(stat -f %Lp "$T/cfg/env" 2>/dev/null || stat -c %a "$T/cfg/env")" = 600 ]'

echo; echo "passed $pass, failed $fail"; [ "$fail" = 0 ]
