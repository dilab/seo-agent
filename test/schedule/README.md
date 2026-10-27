# schedule.sh tests

`bash test/schedule/run.sh` — no network, no real `claude`, no launchd changes. It builds a throwaway git repo with a bare origin and points `SEO_AGENT_CLAUDE` at `fake-claude`, which prints the JSON shape of `claude -p --output-format json` (call 1 ends `next: again`, call 2 `next: tomorrow`; `FAKE_FAIL=1` → `is_error`).

Covered: two-session loop and stop marker; failure → exit 1 after one session; `--max-sessions` cap note; `--dry-run` runs once with the flag; extra args pass through to `/seo-agent:run`; weekend skip unless `--as`; lock skip; dirty tree → exit 3 with the lock released; checkout of the default branch from another branch; `install --print` plist (label, five weekday dicts, `plutil -lint`, `--days 1,3,5`); `env` creates the file with mode 600.

A real end-to-end check (one headless session, no changes): `scripts/schedule.sh run ../<product> --dry-run`.
