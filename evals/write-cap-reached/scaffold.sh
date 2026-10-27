#!/usr/bin/env bash
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/fixture.sh"
fixture_all
{
printf '\n### [B-005] write: export recordings before cancelling\n- type: write\n- cluster: recovery\n- score: 4.2 (potential 5 × ease 10 × fit 8)\n- evidence: vol 140/mo, KD 12, intent informational, top5 median 800 words, ours: none\n- status: open\n'
printf -- '- brief:\n  intent: informational, an admin about to cancel\n  must cover: export formats; where the files go; the order of steps\n  must answer: Can I export everything at once? | What happens to the trash?\n  angle: a checklist\n  format: how-to, 200–2200 words\n  images: hero\n  internal links: /recover-deleted; /how-long-stored\n  avoid: competitor pricing\n  sources: docs/facts.md\n  serp_context: seo/data/serp/export-before-cancelling.json\n'
} >> seo/backlog.md
echo '{"keyword":"export recordings before cancelling","top":[],"paa":[],"features":[],"existing":null}' > seo/data/serp/export-before-cancelling.json
echo "- $TODAY B-001 write /storage-limits pr#1" >> seo/done.md
commit_planning "seo: analysis $TODAY — 1 item"

