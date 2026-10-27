#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
for i in 3 4 5; do
case $i in 3) t=/storage-full;k="storage full what to do";c=storage;; 4) t=/how-long-stored;k="how long are recordings stored";c=retention;; 5) t=/recover-deleted;k="recover deleted recordings";c=recovery;; esac
refresh_item "B-00$i" "$k" "$c" "$t" 2.1 "in-review:#$i" "branch: seo/B-00$i${t//\//-}" "claimed: $TODAY" "review: round 1 ready $TODAY"
add_pr "$i" OPEN "seo: refresh $t" "seo/B-00$i${t//\//-}" "seo,ready" ""
done
commit_planning "seo: analysis $TODAY — 3 items"

