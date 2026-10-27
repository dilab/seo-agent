#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
refresh_item B-003 "recover deleted recordings" recovery /recover-deleted 2.1 "in-review:#5" "branch: seo/B-003-recover-deleted" "claimed: $TODAY" "review: round 1 needs-work $TODAY"
commit_planning "seo: analysis $TODAY — 1 item"
branch_with_section seo/B-003-recover-deleted content/guides/recover-deleted.md "seo: refresh B-003 /recover-deleted" <<'EOF'
## Export a copy before you need it

You can leverage the export menu to download an MP4 copy of any recording, which is the simplest insurance against an emptied trash. See the [restore from backup guide](/restore-from-backup) for the reverse direction.
EOF
add_pr 5 OPEN "seo: refresh /recover-deleted" seo/B-003-recover-deleted "seo,needs-work" "$(pr_body B-003 /recover-deleted "added an export section")"
L=$(git show origin/seo/B-003-recover-deleted:content/guides/recover-deleted.md | grep -n 'leverage' | cut -d: -f1)
add_comment 5 "<!-- seo-review round 1: needs-work -->
Blocking findings:
1. content/guides/recover-deleted.md:$L — banned word \"leverage\" (voice.md › Banned words) — replace with \"use\"
2. content/guides/recover-deleted.md:$L — internal link /restore-from-backup does not exist (validator: link) — remove the sentence that links to it
Notes: none.
Fix these and the next write/refresh run (or /seo-agent:revise --pr 5) picks the PR up."

