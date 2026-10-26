# discover.js fixture

A synthetic product root (`seo/`) plus a `gsc.js site` snapshot. Run from the plugin root:

```
node scripts/discover.js --root test/discover --snapshot test/discover/snapshot.json --max 2 --today 2026-10-26
```

Expected (floor 25, max 2):

| path | action | reasons | keyword (source) | cluster | why |
|---|---|---|---|---|---|
| /g-guide | new | striking | auto delete settings (h1) | retention | no queries in GSC → h1; owner commit 2026-10-22 → `human_edited` |
| /a-guide | new | decaying | storage limit (gsc) | storage | hub of `storage`; `tracked: true` |
| /b-guide | annotate | striking | how long are recordings stored (gsc) | retention | open item B-002 targets it |
| /i-guide | deferred | striking | export recordings before cancelling (gsc) | download | third new candidate, over `--max 2` |

Order is `gsc_potential` desc, then impressions.

Skipped: /c-guide (done 2026-10-16, B-001), /e-guide (B-003 in-review), /f-guide (rejected 2026-09-26), /h-guide (never-write), /pricing (kind pricing), /ghost (not in inventory). Tools: /d-tool (striking).
