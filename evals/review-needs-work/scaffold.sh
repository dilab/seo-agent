#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
refresh_item B-003 "recover deleted recordings" recovery /recover-deleted 2.1 "in-review:#5" "branch: seo/B-003-recover-deleted" "claimed: $TODAY"
commit_planning "seo: analysis $TODAY — 1 item"
branch_with_section seo/B-003-recover-deleted content/guides/recover-deleted.md "seo: refresh B-003 /recover-deleted" <<'EOF'
## Export a copy before you need it

You can leverage the export menu to download an MP4 copy of any recording, which is the simplest insurance against an emptied trash. See the [restore from backup guide](/restore-from-backup) for the reverse direction.
EOF
add_pr 5 OPEN "seo: refresh /recover-deleted" seo/B-003-recover-deleted seo "$(pr_body B-003 /recover-deleted "added an export section")"

