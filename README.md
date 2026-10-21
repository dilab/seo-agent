# seo-agent (plugin)


## Try it locally
```
npm install && npx playwright install chromium
cd ../recordmover
claude --plugin-dir ../seo-agent
/seo-agent:brand        # extracts seo/brand.json + CLAUDE.md design block
/seo-agent:frames       # installs seo/frames, renders seo/frames/contact-sheet.png
```
Without a repo: `cd test && node ../scripts/render.js --contact-sheet --brand seo/brand.json --frames seo/frames --out seo/frames/contact-sheet.png`

## Env
`DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD` for analysis (skill drafted, untested).
