#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
fix_item B-006 /storage-full 2.1 open "description: description is 190 chars (max 165)"
commit_planning "seo: analysis $TODAY — 1 item"

