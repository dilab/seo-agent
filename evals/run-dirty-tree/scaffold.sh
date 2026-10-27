#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
refresh_item B-004 "how long are recordings stored" retention /how-long-stored 2.1 open
commit_planning "seo: analysis $TODAY — 1 item"
echo "owner notes, not committed" > notes.txt

