# Evals — behaviour tests for the skills

The skills are prose; a wording change can silently alter what `run`, `review`, `write` or `fix` does. Each case here scaffolds a small fixture product (Markdown guides, planning files, git history, a bare origin, a stand-in `gh` with local PR state), invokes one skill with a fixed prompt, and grades the outcome deterministically (files written, `gh` calls made, git commands used) plus one LLM judge where wording matters.

```
npm run eval                       # all cases, 1 run each, ~10–25 min, a few dollars on your subscription
npm run eval -- --tag run          # only the run-decision cases (cheap, ~1 min each)
npm run eval -- --case 'review-*'  # the review cases
npm run eval -- --runs 3           # stability: 3 runs per case
```

`npm run eval` expands to `claude plugin eval . --trust-plugin --scaffold --allow-tools Bash Edit Write MultiEdit --ablation none --no-publish --runs 1`. The flags matter: `--scaffold` runs each case's `scaffold.sh` (it builds the fixture), `--allow-tools` lets the skill run git/node/gh and edit files, `--ablation none` skips the pointless no-plugin arm. Results land in `evals/results/<timestamp>/` (`report.html`, `aggregate-result.json`); the run is a pass when every case scores 1.0.

Layout: `_lib/fixture.sh` (the product and helpers: `refresh_item`, `fix_item`, `add_pr`, `add_comment`, `branch_with_section`, `commit_planning`), `_lib/gh.js` (the stand-in `gh`: `.gh/prs.json`, every call appended to `.gh/calls.log`, comments in `.gh/comments/<n>.md`), one directory per case with `case.yaml` + `scaffold.sh`.

| case | skill | what it pins down |
|---|---|---|
| run-dry-tuesday-slot-done | run | the git ledger: a slot used today is not reused |
| run-dry-review-first | run | an unlabelled PR is reviewed before the day's slot |
| run-pr-cap | run | at open_prs_max it prints merge lines and stops |
| run-dirty-tree | run | a dirty tree stops everything; nothing stashed or committed |
| review-sweep-merged | review | merged PR → done.md line, status done, sweep commit |
| review-needs-work | review | banned word + broken link → needs-work with file:line, branch untouched |
| review-ready | review | clean additive PR → ready, no merge while Auto-merge is empty |
| write-cap-reached | write | a write merged this calendar week blocks a second one |
| fix-already-fixed | fix | a finding the owner already fixed → done (already fixed), no PR |
| revise-applies-fixes | revise | applies only the listed fixes, pushes, comments, removes the label |

Adding a case: copy a directory, change the scaffold state and the graders. Keep graders deterministic where possible (`regex` on `{ source: file, path }`, `tool_used` on Bash with an `input_match`); use one `llm` grader for judgement calls and write its PASS and FAIL conditions concretely. The fixture must stay valid: `bash -c '. evals/_lib/fixture.sh; fixture_all'` in an empty directory with `HOME` pointed at a scratch folder, then run the validator over `content/guides/*.md`.

Not covered (on purpose): `write`/`refresh` producing an article (needs DataForSEO SERP context, images and a long session), `keywords`/`analysis` (DataForSEO), `feedback` (GSC). Those are verified by the manual week and the review cases.
