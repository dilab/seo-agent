#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
refresh_item B-003 "recover deleted recordings" recovery /recover-deleted 2.1 "in-review:#5" "branch: seo/B-003-recover-deleted" "claimed: $TODAY"
refresh_item B-004 "how long are recordings stored" retention /how-long-stored 2.1 open
commit_planning "seo: analysis $TODAY — 2 items"
branch_with_section seo/B-003-recover-deleted content/guides/recover-deleted.md "seo: refresh B-003 /recover-deleted" <<'EOF'
## Does the trash count against storage?

Yes. A recording in the trash still counts against the plan limit until it is gone, so emptying the trash frees that space at once. A recording that was archived to Google Drive, Dropbox or Amazon S3 before it was deleted is unaffected: the copy in your own storage stays, and it no longer counts against the limit. The [storage limits guide](/storage-limits) explains what counts.

Can support restore a recording instead? No. After the 30-day window, permanent deletion is permanent on every plan, so the archive copy is the only way back.
EOF
add_pr 5 OPEN "seo: refresh /recover-deleted" seo/B-003-recover-deleted seo "$(pr_body B-003 /recover-deleted "added a section answering whether the trash counts against storage")"

