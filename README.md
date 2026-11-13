# Teppan Cookbook

A household cooking app: recipes that scale by servings, a shop list built from recipes, a shared grocery list (by store section, with usuals and tick-off), a cook log and a glossary. Version 0.7, built for two people (Spine change set CS-066).

The page is static (`index.html` at the root, served by GitHub Pages). Data lives in Google Sheets and is read and written through a Google Apps Script web app (`src/Code.gs`), which runs as the Sheets' owner.

## Layout
- `index.html`, `manifest.json`, `sw.js`, icons: the published app.
- `src/build.py`: builds `index.html` from `src/notebook-v3.html` (the earlier Teppan Notebook) plus `src/list.js`, with the endpoint URL as an argument.
- `src/Code.gs`: the Apps Script endpoint (deployed separately in Apps Script).
- `src/teppan-click-test.py`, `src/fixtures.py`: browser click test (Playwright) against a mocked endpoint.
- `src/test-endpoint.js`: endpoint tests against a fake spreadsheet (Node).
- `src/make-icon.py`: draws the icons.

## Rebuild
    python3 src/build.py src/notebook-v3.html src/list.js "<endpoint /exec URL>" index.html
    python3 src/build.py src/notebook-v3.html src/list.js "https://script.google.com/macros/s/TEST/exec" /tmp/site/index.html
    python3 src/teppan-click-test.py /tmp/site
    node src/test-endpoint.js

Bump the `CACHE` name in `sw.js` on every publish so phones fetch the new page.
