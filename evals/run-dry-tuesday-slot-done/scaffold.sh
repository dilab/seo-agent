#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
refresh_item B-002 "storage full what to do" storage /storage-full 2.3 "done:$TODAY" "branch: seo/B-002-storage-full" "claimed: $TODAY" "review: round 1 ready $TODAY"
refresh_item B-004 "how long are recordings stored" retention /how-long-stored 2.1 open
echo "- $TODAY B-002 refresh /storage-full pr#3" >> seo/done.md
commit_planning "seo: analysis $TODAY — 2 items"
git commit -q --allow-empty -m "seo: claim B-002"
git commit -q --allow-empty -m "seo: B-002 in review"
git commit -q --allow-empty -m "seo: review B-002 round 1"
git commit -q --allow-empty -m "seo: sweep PRs $TODAY"
git push -q origin main 2>/dev/null
add_pr 3 MERGED "seo: refresh /storage-full" seo/B-002-storage-full "seo,ready" "" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

