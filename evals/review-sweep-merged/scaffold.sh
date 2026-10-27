#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
refresh_item B-002 "storage full what to do" storage /storage-full 2.3 "in-review:#3" "branch: seo/B-002-storage-full" "claimed: $TODAY" "review: round 1 ready $TODAY"
commit_planning "seo: analysis $TODAY — 1 item"
add_pr 3 MERGED "seo: refresh /storage-full" seo/B-002-storage-full "seo,ready" "" "$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d yesterday +%Y-%m-%dT%H:%M:%SZ)"

