#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
refresh_item B-004 "how long are recordings stored" retention /how-long-stored 2.1 "in-review:#6" "branch: seo/B-004-how-long-stored" "claimed: $TODAY"
commit_planning "seo: analysis $TODAY — 1 item"
branch_with_section seo/B-004-how-long-stored content/guides/how-long-stored.md "seo: refresh B-004 /how-long-stored" <<'EOF'
## Does the trash count against storage?

Yes. A recording in the trash still counts against the plan limit until it is gone, so emptying the trash frees that space at once. A recording that was archived to Google Drive, Dropbox or Amazon S3 before it was deleted is unaffected: the copy in your own storage stays, and it no longer counts against the limit. The [storage limits guide](/storage-limits) explains what counts.

Can support restore a recording instead? No. After the 30-day window, permanent deletion is permanent on every plan, so the archive copy is the only way back.
EOF
add_pr 6 OPEN "seo: refresh /how-long-stored" seo/B-004-how-long-stored seo "$(pr_body B-004 /how-long-stored "added a section answering the brief's PAA: does the trash count against storage (facts from docs/facts.md)")"

