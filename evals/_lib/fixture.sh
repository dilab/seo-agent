#!/usr/bin/env bash
# Shared fixture for the eval cases: a small Markdown product ("Clipvault") with four guides,
# the seo/ planning files, a git history whose subjects start with `seo:`, a bare origin in
# $HOME, and a stand-in `gh` in ./bin backed by .gh/prs.json. Sourced by each case's scaffold.sh,
# which then adds the state that case is about. Everything below runs inside the empty workspace.
set -euo pipefail
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$(cd "$LIB/../.." && pwd)"
TODAY="$(date +%F)"
export GIT_AUTHOR_NAME=eval GIT_AUTHOR_EMAIL=eval@example.test GIT_COMMITTER_NAME=eval GIT_COMMITTER_EMAIL=eval@example.test

fixture_product() {
  mkdir -p content/guides public/images/guides docs seo/data/serp seo/data/plans
  cp "$PLUGIN/test/seo/brand.json" seo/brand.json
  cp -R "$PLUGIN/test/seo/frames" seo/frames
  cat > CLAUDE.md <<'EOF'
# Clipvault

Clipvault archives meeting recordings to the storage you already pay for. Marketing site plus guides.

## SEO agent
- Articles: content/guides/*.md, format: Markdown with frontmatter
- Title/description: frontmatter `title` and `description`
- URL slug: frontmatter `slug`; `permalink` is the URL path (/<slug>)
- Images: public/images/guides/<slug>/
- Validate: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-article.js --file <path>
- Sitemap: public/sitemap.xml — static list; add a <url> entry for every new guide
- Preview: https://clipvault.test/<slug>
- PR label: seo
- Human-edited guard: 14 days
- Deploy: git push origin main (the host builds main; production branch: main)
<!-- /seo-agent -->
EOF
  cat > docs/facts.md <<'EOF'
# Clipvault facts (the only source for product claims)

- Free plan: 5 GB of recording storage.
- Team plan: 500 GB of recording storage, $12 per user per month.
- Deleted recordings sit in the trash for 30 days, then they are gone for good. Support cannot restore a recording after that.
- A recording in the trash still counts against storage until it is gone; emptying the trash frees that space at once.
- A recording archived to the owner's own storage no longer counts against the plan limit.
- Exports: MP4 (video) and M4A (audio only).
- Archive destinations: Google Drive, Dropbox, Amazon S3.
EOF
  cat > seo/strategy.md <<'EOF'
# Strategy — Clipvault

## ICP
Small teams that record every call and run out of storage.

## Positioning
Clipvault moves recordings out of the meeting tool into storage you already own, automatically.

## Clusters ★
- storage (priority 1) — hub: /storage-limits — plan limits, storage full, what counts
- retention (priority 2) — hub: /how-long-stored — how long recordings stay, auto delete, trash
- recovery (priority 2) — hub: none — recover deleted recordings, export before cancelling

## Never write about
- bypassing plan limits or terms of service
- competitor pricing

## Caps ★
new_per_week: 1
refresh_per_week: 2
fixes_per_week: 3
open_prs_max: 3
analysis_max_keywords: 5
analysis_budget_usd: 0.50
discovery_budget_usd: 1.00
discovery_per_cluster: 5
discovery_max_items: 2
proposed_auto_accept_days: 7
word_range: 200–2200

## Auto-merge
[]

## Competitors
- example-competitor.test

## Tracked keywords ★
- recording storage limits (cluster: storage)
- storage full what to do (cluster: storage, refresh:/storage-full)
- how long are recordings stored (cluster: retention, refresh:/how-long-stored)
- recover deleted recordings (cluster: recovery, refresh:/recover-deleted)
- export recordings before cancelling (cluster: recovery, write)
EOF
  cat > seo/voice.md <<'EOF'
# Voice — Clipvault

## Tone
- Plain and direct; the first sentence answers the question. ("Deleted recordings sit in the trash for 30 days." — /recover-deleted)
- Numbers come from docs/facts.md, never from memory.
- No hype, no promises about the future.

## Structure
- H1 = the question or task; a one-paragraph direct answer; then H2 sections; a short FAQ at the end.
- The product is mentioned once, near the end, as the structural fix.

## Formatting
- Short paragraphs (≤ 4 sentences). Numbered steps for procedures. Tables only for real comparisons.

## Good paragraphs
- "Deleted recordings sit in the trash for 30 days. After that they are gone for good, so the first thing to check is the trash, not the backup." (/recover-deleted) — answers first, then the next action.

## Bad paragraphs
- "In today's fast-paced world, losing a recording can be devastating, but fear not!" — filler, drama, no fact.

## Banned words and patterns
- delve, leverage, seamless(ly), robust, streamline, unlock, elevate, empower, game-changer, cutting-edge
- "in today's fast-paced world", "whether you're a … or a …", "it's important to note", "at the end of the day"
- rhetorical openers ("Ever wondered…?"), triple adjectives, exclamation marks
- em-dash chains; more than one parenthetical per paragraph

## Product claims
- Every number or capability about Clipvault must appear in docs/facts.md. A claim that is not there is a blocking finding.
EOF
  cat > seo/review-rubric.md <<'EOF'
# Review rubric — Clipvault additions

## Product-specific checks
- Every Clipvault number (storage sizes, prices, retention days) matches docs/facts.md
- A guide links to its cluster hub (strategy.md › Clusters) at least once
- Internal links resolve to pages in seo/inventory.json

## Automatic fails
- Any banned word from seo/voice.md
- A broken internal link
EOF
  cat > seo/done.md <<'EOF'
# Done — Clipvault

<!-- one line per merged PR: - <date> <id> <type> <path> pr#<n> -->
EOF
  cat > seo/rejected.md <<'EOF'
# Rejected — Clipvault

<!-- one line per closed PR: - <date> <id> <type> <path> pr#<n> | "<reason>" -->
EOF
  cat > seo/backlog.md <<'EOF'
# Backlog — Clipvault

<!-- items are appended by /seo-agent:analysis; statuses: open, claimed:<date>, in-review:#n, done:<date>, rejected:#n, blocked:<why>, dropped -->
EOF
  cat > public/sitemap.xml <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://clipvault.test/</loc></url>
  <url><loc>https://clipvault.test/storage-limits</loc></url>
  <url><loc>https://clipvault.test/storage-full</loc></url>
  <url><loc>https://clipvault.test/how-long-stored</loc></url>
  <url><loc>https://clipvault.test/recover-deleted</loc></url>
</urlset>
EOF
  cat > content/guides/storage-limits.md <<'EOF'
---
title: "Recording storage limits by plan: what counts and what to do"
description: "How much recording storage each Clipvault plan includes, what counts against it, how to see your usage, and the three ways to stay under the limit."
slug: storage-limits
permalink: /storage-limits
date: 2026-08-02
cluster: storage
---

# Recording storage limits by plan

The free plan includes 5 GB of recording storage and the team plan includes 500 GB. Every recording you keep in Clipvault counts against that number until you delete it or move it to your own storage. When you reach the limit, new recordings are still captured but they wait in a queue until space is free.

This guide explains what counts, how to check where you stand, and how to stay under the limit without deleting anything you still need.

## What counts against the limit

Video recordings count at their full file size. Audio-only recordings are far smaller, usually under a tenth of the video size for the same meeting. Transcripts and chat logs do not count at all. Recordings in the trash still count until the 30-day trash window ends or you empty the trash yourself.

## How to see your usage

1. Open Settings and choose Storage.
2. The bar at the top shows used space against the plan limit.
3. The list below sorts recordings by size, largest first, so the quickest wins are at the top.

## Three ways to stay under the limit

**Delete what you will never watch.** Most teams find that a third of their recordings were never opened after the first week. Sorting by size and by last opened date makes those easy to spot.

**Record audio only for internal calls.** Stand-ups and check-ins rarely need video. Switching those to audio keeps the same searchable transcript at a fraction of the size.

**Archive to storage you already own.** Clipvault can move every finished recording to Google Drive, Dropbox or Amazon S3 as soon as it is processed, so the plan limit stops being the ceiling. The [storage full guide](/storage-full) walks through setting that up when you are already at the limit.

## Frequently asked questions

### Does upgrading clear the queue?

Yes. Queued recordings are processed as soon as the new limit applies, usually within a few minutes.

### Do shared recordings count twice?

No. A recording counts once, against the account that recorded it, no matter how many people it is shared with.
EOF
  cat > content/guides/storage-full.md <<'EOF'
---
title: "Recording storage full? Here is what to do, in order"
description: "Your recording storage is full and new meetings are queuing. The four steps that free space fastest, what the trash does, and how to stop it happening again."
slug: storage-full
permalink: /storage-full
date: 2026-08-16
cluster: storage
---

# Recording storage full: what to do, in order

When your recording storage is full, new recordings are not lost: they wait in a queue until space is free. The fastest fix is to empty the trash, because trashed recordings count against the limit for 30 days. After that, delete the largest recordings you no longer need, then set up an archive so it does not happen again.

The [storage limits guide](/storage-limits) explains what counts; this page is the order of operations when you are already at the ceiling.

## Step 1: empty the trash

Deleted recordings stay in the trash for 30 days and count against your storage the whole time. Open Settings, choose Storage, then Trash, and empty it. On most full accounts this alone frees a fifth of the limit.

## Step 2: delete the largest recordings you will not watch

Sort the storage list by size. Long video recordings of internal meetings are the usual culprits. Check the last opened date before deleting: a recording nobody has opened in a month is rarely missed.

## Step 3: switch internal calls to audio only

An audio-only recording is a fraction of the size of the video and keeps the same transcript. Change the default for recurring internal meetings in the meeting settings.

## Step 4: archive to your own storage

Set up an archive destination (Google Drive, Dropbox or Amazon S3) so every processed recording is moved out automatically. The plan limit then only applies to recordings that have not been archived yet, which is usually a day's worth.

## Frequently asked questions

### Will queued recordings be deleted?

No. They wait until space is free, then process in the order they were recorded.

### Does emptying the trash delete recordings elsewhere?

No. A recording that was already archived to your own storage stays there. Emptying the trash removes only the copy in Clipvault.
EOF
  cat > content/guides/how-long-stored.md <<'EOF'
---
title: "How long are recordings stored? Retention by plan and the trash"
description: "How long Clipvault keeps recordings on each plan, what happens when you delete one, the 30-day trash window, and how to keep recordings for good."
slug: how-long-stored
permalink: /how-long-stored
date: 2026-08-30
cluster: retention
---

# How long are recordings stored?

Recordings are kept until you delete them, on every plan. Deleting a recording moves it to the trash for 30 days, after which it is gone for good. The only time a recording leaves on its own is when you cancel the account.

This guide covers the retention rules, what the trash does, and how to keep a recording permanently.

## Retention on each plan

Neither the free plan nor the team plan deletes recordings on a schedule. The limit you run into is storage space, not time: the free plan holds 5 GB and the team plan 500 GB, and once that is full new recordings queue rather than overwrite old ones. The [storage limits guide](/storage-limits) explains what counts.

## What happens when you delete a recording

1. The recording moves to the trash and stays visible there for 30 days.
2. It still counts against your storage during those 30 days.
3. You can restore it from the trash at any point in that window.
4. After 30 days it is deleted permanently and cannot be recovered. The [recover deleted recordings guide](/recover-deleted) covers what you can still do.

## Keeping a recording for good

Archive it. Clipvault moves recordings to Google Drive, Dropbox or Amazon S3, and a recording in your own storage follows your own retention rules, not the plan's. Exports are MP4 for video and M4A for audio only.

## Frequently asked questions

### Do recordings expire on the free plan?

No. They stay until you delete them or the account is cancelled.

### Does restoring from the trash change the date?

No. A restored recording keeps its original recording date and its place in the list.
EOF
  cat > content/guides/recover-deleted.md <<'EOF'
---
title: "How to recover deleted recordings (and when you cannot)"
description: "Deleted recordings sit in the trash for 30 days. How to restore one, what to check when it is not there, and how to make sure a recording can always be recovered."
slug: recover-deleted
permalink: /recover-deleted
date: 2026-09-12
cluster: recovery
---

# How to recover deleted recordings

Deleted recordings sit in the trash for 30 days. After that they are gone for good, so the first thing to check is the trash, not the backup. If the recording was archived to your own storage before it was deleted, it is still there and you can download it from that location.

## Restore from the trash

1. Open Settings and choose Storage, then Trash.
2. Find the recording; the list sorts by deletion date, newest first.
3. Choose Restore. The recording returns to its original place with its original date.

## When it is not in the trash

Three things empty the trash early: the 30 days passed, someone emptied the trash by hand, or the account was cancelled. In each case the copy in Clipvault is gone. Check the archive destination next: a recording that was moved to Google Drive, Dropbox or Amazon S3 is unaffected by anything that happens in Clipvault.

## Making recordings recoverable

Set up an archive destination so every processed recording leaves Clipvault automatically. Then the trash is a convenience rather than the last line of defence. The [how long recordings are stored](/how-long-stored) guide explains the retention rules the archive copy follows.

## Frequently asked questions

### Can support restore a recording after 30 days?

No. Permanent deletion is permanent on every plan.

### Does restoring count against storage again?

Yes. A restored recording counts against the limit as before, because it never stopped counting while it was in the trash.
EOF
}

fixture_git() {
  git init -q .
  git config user.email eval@example.test; git config user.name eval; git config commit.gpgsign false
  git checkout -q -b main 2>/dev/null || true
  printf 'bin/\n.gh/\n' >> .git/info/exclude
  git add -A && git commit -q -m "seo: fixture import"
  git init -q --bare "$HOME/origin.git"
  git remote add origin "$HOME/origin.git"
  git push -q -u origin main 2>/dev/null
  git -C "$HOME/origin.git" symbolic-ref HEAD refs/heads/main
}

fixture_inventory() {
  node "$PLUGIN/scripts/inventory.js" --root . >/dev/null
  git add seo/inventory.json && git commit -q -m "seo: inventory $TODAY"
  git push -q origin main 2>/dev/null
}

fixture_gh() {
  mkdir -p bin .gh/comments
  cp "$LIB/gh.js" bin/gh.js
  printf '#!/usr/bin/env bash\nexport FAKE_GH_ROOT="$(cd "$(dirname "$0")/.." && pwd)"\nexec node "$FAKE_GH_ROOT/bin/gh.js" "$@"\n' > bin/gh
  chmod +x bin/gh
  echo '[]' > .gh/prs.json
  : > .gh/calls.log
}

# add_pr <number> <state> <title> <branch> <labels,comma> <bodyfile> [mergedAt]
add_pr() {
  node -e '
    const fs=require("fs");const [n,state,title,branch,labels,bodyfile,mergedAt]=process.argv.slice(1);
    const prs=JSON.parse(fs.readFileSync(".gh/prs.json","utf8"));
    const body=bodyfile&&fs.existsSync(bodyfile)?fs.readFileSync(bodyfile,"utf8"):"";
    let files=[],commits=[];
    try{const cp=require("child_process");
      files=cp.execSync(`git diff --numstat main...origin/${branch}`).toString().trim().split("\n").filter(Boolean).map(l=>{const [a,d,p]=l.split("\t");return {path:p,additions:+a,deletions:+d}});
      commits=cp.execSync(`git log --format=%H%x09%s main..origin/${branch}`).toString().trim().split("\n").filter(Boolean).map(l=>{const [oid,s]=l.split("\t");return {oid,messageHeadline:s,authors:[{login:"eval-owner"}]}});
    }catch(e){}
    prs.push({number:+n,state,title,body,headRefName:branch,baseRefName:"main",labels:labels?labels.split(",").map(name=>({name})):[],comments:[],reviews:[],files,commits,mergedAt:mergedAt||null,closedAt:state==="CLOSED"?new Date().toISOString():null,url:`https://github.com/eval-owner/product/pull/${n}`,createdAt:new Date(Date.now()-3600e3).toISOString()});
    fs.writeFileSync(".gh/prs.json",JSON.stringify(prs,null,2));' "$@"
}

# add_comment <number> <text>
add_comment() {
  node -e '
    const fs=require("fs");const [n,body]=process.argv.slice(1);
    const prs=JSON.parse(fs.readFileSync(".gh/prs.json","utf8"));const pr=prs.find(p=>p.number==n);
    pr.comments.push({author:{login:"eval-owner"},body,createdAt:new Date().toISOString()});
    fs.writeFileSync(".gh/prs.json",JSON.stringify(prs,null,2));
    fs.appendFileSync(`.gh/comments/${n}.md`, body+"\n\n<!-- end of comment -->\n\n");' "$1" "$2"
}

# refresh_item <id> <keyword> <cluster> <target> <score> <status> [extra lines…]
refresh_item() {
  local id="$1" kw="$2" cluster="$3" target="$4" score="$5" status="$6"; shift 6
  local slug="${target#/}"
  cat > "seo/data/serp/$slug.json" <<EOF
{"keyword":"$kw","date":"$TODAY","top":[{"rank":1,"url":"https://example-competitor.test/$slug","domain":"example-competitor.test","title":"$kw","headings":["Overview","Steps","FAQ"],"word_count":900}],"paa":["Can support restore it?","Does the trash count against storage?"],"features":["people_also_ask"],"existing":"$target"}
EOF
  {
    printf '\n### [%s] refresh: %s\n' "$id" "$kw"
    printf -- '- type: refresh\n- cluster: %s\n- target: %s\n- score: %s (potential 3 × ease 10 × fit 7)\n' "$cluster" "$target" "$score"
    printf -- '- evidence: vol 90/mo (topic 140: kw + 2 PAA), KD 18, intent informational, top5 median 900 words, features: people_also_ask, ours: 14, pages parsed 3/5\n'
    printf -- '- status: %s\n' "$status"
    for l in "$@"; do printf -- '- %s\n' "$l"; done
    printf -- '- brief:\n  intent: informational, a team admin who just hit the problem\n  must cover: the direct answer; the exact steps; what to do when the steps fail\n  must answer: Can support restore it? | Does the trash count against storage?\n  angle: lead with the fact, then the steps, then the structural fix\n  format: how-to, 200–2200 words\n  images: none\n  internal links: hub of the cluster; one sibling guide\n  avoid: competitor pricing; promises about future features\n  sources: docs/facts.md\n  serp_context: seo/data/serp/%s.json\n' "$slug"
  } >> seo/backlog.md
}

# fix_item <id> <target> <score> <status> <fix lines…>
fix_item() {
  local id="$1" target="$2" score="$3" status="$4"; shift 4
  {
    printf '\n### [%s] fix: %s\n- type: fix\n- target: %s\n- score: %s (potential 3 × ease 10 × fit 7)\n- evidence: sitecheck %s: %s findings\n- status: %s\n- fixes:\n' "$id" "$target" "$target" "$score" "$TODAY" "$#" "$status"
    for l in "$@"; do printf '  %s\n' "$l"; done
  } >> seo/backlog.md
}

# branch_with_section <branch> <file> <commit subject> <<'EOF' … section text … EOF  (reads the section from stdin)
branch_with_section() {
  local branch="$1" file="$2" subject="$3"
  local section; section="$(cat)"
  git checkout -q -b "$branch"
  node -e '
    const fs=require("fs");const [file,section]=process.argv.slice(1);
    let t=fs.readFileSync(file,"utf8");
    const i=t.indexOf("\n## Frequently asked questions");
    t = i>=0 ? t.slice(0,i)+"\n"+section.trim()+"\n"+t.slice(i) : t+"\n"+section.trim()+"\n";
    fs.writeFileSync(file,t);' "$file" "$section"
  git add "$file" && git commit -q -m "$subject"
  git push -q -u origin "$branch" 2>/dev/null
  git checkout -q main
}

commit_planning() {  # commit_planning <subject>  — commits whatever changed under seo/ on main and pushes
  git add seo && git commit -q -m "$1" && git push -q origin main 2>/dev/null
}

pr_body() {  # pr_body <id> <target> <one-line change> → path of a body file
  local f; f="$(mktemp "${TMPDIR:-/tmp}/body.XXXXXX")"
  cat > "$f" <<EOF
## $1 — refresh $2

**Keyword**: see backlog item $1

### What changed
- $3

### Checks
- validator: pass, words within 200–2200, images 0/0
- review: pending
EOF
  echo "$f"
}

fixture_all() { fixture_product; fixture_git; fixture_inventory; fixture_gh; }
