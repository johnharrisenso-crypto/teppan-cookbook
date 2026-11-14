"""Builds Teppan Cookbook (index.html) from Teppan Notebook version 3 plus list.js.
Usage: python3 build.py notebook-v3.html list.js API_URL out/index.html
Every replacement must match exactly once, or the build stops (Jidoka)."""
import sys, re

src, listjs, api_url, out = sys.argv[1:5]
h = open(src, encoding="utf-8").read()
L = open(listjs, encoding="utf-8").read()

def sub(old, new, count=1):
    global h
    n = h.count(old)
    if n != count:
        sys.exit(f"BUILD STOP: expected {count} match(es), found {n}: {old[:80]!r}")
    h = h.replace(old, new)

def sub_re(pat, new):
    global h
    m = re.findall(pat, h, flags=re.S)
    if len(m) != 1:
        sys.exit(f"BUILD STOP: regex matched {len(m)} times: {pat[:80]!r}")
    h = re.sub(pat, lambda _: new, h, flags=re.S)

# --- head: name, home-screen app tags, no Claude-only meta ---
sub("<title>Teppan Notebook</title>", "<title>Teppan Cookbook</title>")
sub('<meta name="claude:viewport-fit-sides" content="cover">',
    '<link rel="manifest" href="manifest.json">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-title" content="Cookbook">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
    '<meta name="theme-color" content="#EEF0EC">\n<link rel="icon" type="image/png" href="apple-touch-icon.png">')
sub("/* Version 3 (CS-066, 2026-11-05):",
    "/* Teppan Cookbook version 0.7.5 (CS-066, 2026-11-14: move an item's section or store from its detail; moves are learned, endpoint v3). 0.7.4 (2026-11-13: word list wins over the Pantry's coarse sections; lunch meat to Deli). 0.7.3 (2026-11-13: Andronico's is the default store; List filter by store). 0.7.2 (2026-11-13: sections guessed for everyday items, no section picker). 0.7.1 (2026-11-12: a list read in flight no longer hides a just-added item; Loading text; favicon). 0.7 (2026-11-11): standalone app on Netlify; data through the Apps Script endpoint (no Claude or Google sign-in); new List tab, the shared grocery list. Built from Teppan Notebook version 3 by build.py. */\n/* Notebook version 3 (CS-066, 2026-11-05):")

# --- five tabs ---
sub("grid-template-columns:repeat(4,1fr)", "grid-template-columns:repeat(5,1fr)")
sub('  <a href="#shop" data-tab="shop"><span class="k">買物</span>Shop</a>\n',
    '  <a href="#shop" data-tab="shop"><span class="k">買物</span>Shop</a>\n  <a href="#list" data-tab="list"><span class="k">一覧</span>List</a>\n')

# --- constants: endpoint instead of the connector ---
sub_re(r'const SHEET_ID = .*?const GROCERY_HEAD = \[[^\]]*\];\n',
       f'const API_URL = "{api_url}"; // Apps Script web app bound to the Grocery list Sheet (Spine/Cooking)\n'
       f'const PEOPLE = ["John", "Courtney"];\n')
sub("let mcp = null, D = null, syncedAt = null, saving = false;", "let D = null, L = null, syncedAt = null, saving = false;")

# --- data layer: one call returns every cooking tab plus the list ---
sub_re(r'/\* ---------- connector ---------- \*/.*?(?=\nfunction checkHead)', L)
sub_re(r'async function loadAll\(\)\{.*?\n\}\nlet refreshing = false;',
       '''async function loadAll(){
  const gen = listGen;
  try{
    const s = await api({action:"state", recipes:true});
    const problems = Object.keys(TABS).map(n => checkHead(n, (s.raw[n] || [])[0] || [])).filter(Boolean);
    if(problems.length) throw {message: problems.join(" ")};
    D = shape(s.raw); syncedAt = new Date(); store.set("cache", {raw: s.raw, at: syncedAt.toISOString()});
    if(gen === listGen && !pending() && !flushing){ L = {list: s.list, usual: s.usual, sections: s.sections, learned: s.learned || []}; listAt = new Date(); cacheList(); }
    hideBanner();
  }catch(e){
    const c = store.get("cache", null);
    if(!D && c){ D = shape(c.raw); syncedAt = new Date(c.at); }
    showBanner(errText(e) + (D ? " Showing the copy saved on this phone." : ""), "Refresh", refresh);
  }
}
let refreshing = false;''')
sub("if(refreshing || !mcp) return; refreshing = true;", "if(refreshing) return; refreshing = true;")
sub("try{ await loadAll(); render(); } finally { refreshing = false; }", "try{ await loadAll(); render(); flush(); } finally { refreshing = false; }")

# --- routes ---
sub('if(!D){ $app.innerHTML = `<p class="empty">No data yet. Tap Refresh once Google Sheets is connected.</p>`; return; }',
    'if(r === "list") return viewList();\n  if(!D){ $app.innerHTML = `<p class="empty">Loading recipes… The first time needs a signal; after that this phone keeps a copy.</p>`; return; }')

# --- Shop: send to the shared list through the same queue as the List tab (works offline) ---
sub('Adds what isn\'t ticked here to the shared Groceries list (the one Courtney sees). Items already on it are skipped.',
    'Puts what isn\'t ticked here on the shared List. Items already on it are skipped.')
sub("Send unchecked items to the grocery list", "Send unchecked items to the List", count=2)
sub_re(r'/\* Push to the shared grocery list \(CS-066\).*?\n\}\n\nfunction todayISO',
       '''/* Push to the shared grocery list (CS-066): queued like any List change, so it works with no signal. */
let sending = false;
function sendToGrocery(need, got){
  if(sending) return; sending = true;
  try{
    const items = Object.values(need).filter(e => !got[e.p.id]);
    const skipped = [], send = [];
    items.forEach(e => {
      const p = e.p;
      if(openOnList(p.item)){ skipped.push(p.item); return; }
      const isAmt = p.buy === "amount";
      let qty = isAmt ? Object.entries(e.qty).map(([u,q]) => fmtAmount(q,u).main).join(" + ") : "";
      if(isAmt && p.id === "P16" && e.qty.g) qty += ` (about ${frac(e.qty.g / CABBAGE_HEAD_G).txt} head)`;
      const store_ = /any grocery/i.test(p.where) ? DEFAULT_STORE : "Nijiya";   // Pantry 'Any grocery' means the everyday store
      const note = [isAmt ? "" : "stock item: check what's left", p.look, p.where, "for " + [...e.recipes].join(", ")].filter(Boolean).join(" · ");
      send.push({item:p.item, qty, section: (learnedFor(p.item) || {}).Section || guessByWords(p.item) || p.section, store:store_, note, tmp: tmpId()});
    });
    const out = $app.querySelector("[data-send-result]");
    if(!send.length){ const m = skipped.length ? `Nothing to send: all ${skipped.length} already on the List.` : "Nothing to send."; if(out) out.textContent = m; toast(m); return; }
    enqueue({op:"add", items: send});
    const m = `Put ${send.length} item${send.length===1?"":"s"} on the List.` + (skipped.length ? ` Skipped ${skipped.length} already there.` : "");
    if(out) out.textContent = m; toast(m);
  } finally { sending = false; }
}

function todayISO''')

# --- Log: save through the endpoint ---
sub('    const res = await mcp.callTool(SERVER, "append_values", {spreadsheetId: SHEET_ID, range:"Cooks!A:I", values:[row]}, {cache:false});\n    const p = payloadOf(res);\n    const after = await read(TABS.Cooks.range);\n    const rows = (after && after.values) || [];\n    const ok = rows.some(x => x[0]===row[0] && x[4]===row[4] && x[8]===row[8]);\n',
    '    await api({action:"log", row});   // the endpoint reads the row back and refuses if it differs\n    const ok = true;\n')
sub('toast(ok ? "Saved to your cook log." : "Saved, but the read-back didn\'t find the row. Check the Cooks tab.");', 'toast("Saved to the cook log.");')
sub('showBanner(errText(e) + " Your entry is kept on this device as a draft. If Google Sheets timed out, check the Cooks tab before saving again.");',
    'showBanner(errText(e) + " Your entry is kept on this phone as a draft." + (e && e.offline ? " Save again when there is a signal; if it timed out, check the log before saving twice." : ""));')

# --- start: no Claude; who's using this phone; offline shell ---
sub_re(r'\(async function start\(\)\{.*?\n\}\)\(\);',
       '''(async function start(){
  const c = store.get("cache", null);
  if(c){ D = shape(c.raw); syncedAt = new Date(c.at); }
  const lc = store.get("list", null);
  if(lc && lc.L){ L = lc.L; listAt = lc.at ? new Date(lc.at) : null; qLoad().forEach(applyLocal); }
  if("serviceWorker" in navigator) try{ navigator.serviceWorker.register("sw.js").catch(() => {}); }catch{}
  const go = async () => { render(); await loadAll(); render(); flush(); };
  if(!me()) askMe(go); else go();
})();''')
sub('document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && syncedAt && Date.now() - syncedAt > 60000) refresh(); });',
    'document.addEventListener("visibilitychange", () => { if(document.visibilityState !== "visible") return; if(pending()) flush(); else if(route() === "list") refreshList(true); if(syncedAt && Date.now() - syncedAt > 60000) refresh(); });')

for bad in ["mcp", "callTool", "window.claude", "payloadOf", "GROCERY_ID", "SHEET_ID", "Google Sheets connector"]:
    if bad in h:
        sys.exit(f"BUILD STOP: leftover {bad!r}")
open(out, "w", encoding="utf-8").write(h)
print("built", out, len(h.encode("utf-8")), "bytes")
