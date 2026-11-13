"""Teppan Cookbook click test (CS-066). Sheet plus app pattern: stable data-* selectors, a mocked endpoint that holds
whole tabs, pages loaded by URL from a local server, two viewers, offline queue, storage throwing, 390 px width.
Usage: python3 teppan-click-test.py SITE_DIR [PAGE]   (PAGE defaults to index.html; pass a previous version's file to
show the new checks fail there). A missing element is a failed check, never a crash."""
import sys, os, json, threading, http.server, socketserver, functools, copy, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import RAW, SECTIONS

SITE, PAGE = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "index.html")
API = "https://script.google.com/macros/s/TEST/exec"
LIST_HEAD = ["ID","Item","Qty","Section","Store","Note","Added by","Added","Done","Done by","Done at","Cleared"]

class Mock:
    def __init__(s):
        s.list, s.usual, s.cooks, s.calls, s.offline = [], [], copy.deepcopy(RAW["Cooks"]), [], False
    def sec(s, n):
        n = (n or "").strip()
        for x in SECTIONS:
            if x["Section"].lower() == n.lower() or n.lower() in [a.strip().lower() for a in x["Aliases"].split(",") if a.strip()]:
                return x["Section"]
        return n
    def handle(s, p):
        s.calls.append(p)
        a = p.get("action", "state")
        if a == "state":
            o = {"ok": True, "list": [r for r in s.list if not r["Cleared"]], "usual": s.usual, "sections": SECTIONS}
            if p.get("recipes"):
                raw = copy.deepcopy(RAW); raw["Cooks"] = s.cooks; o["raw"] = raw
            return o
        if a == "add":
            open_ = {r["Item"].lower(): r["ID"] for r in s.list if not r["Done"] and not r["Cleared"]}
            added, mp = [], {}
            for it in p.get("items", []):
                k = it["item"].strip().lower()
                if k in open_: mp[it.get("tmp")] = open_[k]; continue
                rid = "G%04d" % (len(s.list) + 1)
                r = dict(zip(LIST_HEAD, [rid, it["item"], it.get("qty", ""), s.sec(it.get("section")), it.get("store", ""), it.get("note", ""), p.get("by", ""), "2026-11-11T22:00:00Z", "", "", "", ""]))
                s.list.append(r); added.append(r); open_[k] = rid
                if it.get("tmp"): mp[it["tmp"]] = rid
            return {"ok": True, "added": added, "map": mp}
        if a == "tick":
            r = next((x for x in s.list if x["ID"] == p.get("id")), None)
            if not r: return {"ok": False, "error": "No row " + str(p.get("id"))}
            r["Done"], r["Done by"] = ("yes", p.get("by", "")) if p.get("done") else ("", "")
            return {"ok": True, "row": r}
        if a == "remove":
            r = next((x for x in s.list if x["ID"] == p.get("id")), None)
            if not r: return {"ok": False, "error": "No row"}
            r["Cleared"] = "x"; return {"ok": True}
        if a == "clear":
            n = 0
            for r in s.list:
                if r["Done"] and not r["Cleared"]: r["Cleared"] = "x"; n += 1
            return {"ok": True, "cleared": n}
        if a == "usual":
            s.usual = [u for u in s.usual if u["Item"].lower() != p["item"].lower()]
            if p.get("star"): s.usual.append({"ID": "U%03d" % (len(s.usual) + 1), "Item": p["item"], "Qty": p.get("qty", ""), "Section": s.sec(p.get("section")), "Store": p.get("store", "")})
            return {"ok": True, "usual": s.usual}
        if a == "log":
            row = p.get("row") or []
            if len(row) != 9: return {"ok": False, "error": "A cook row needs 9 values"}
            s.cooks.append(row); return {"ok": True, "row": len(s.cooks)}
        return {"ok": False, "error": "Unknown action"}

M = Mock()
results = []
def check(name, fn):
    try:
        ok = bool(fn())
    except Exception as e:
        ok = False; name += f"  [{type(e).__name__}: {(str(e).splitlines() or [''])[0][:90]}]"
    results.append((ok, name)); print(("PASS " if ok else "FAIL ") + name)

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
    h.log_message = lambda *a: None
    srv = socketserver.TCPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
srv = serve(); BASE = f"http://127.0.0.1:{srv.server_address[1]}/{PAGE}"

def route(r):
    if M.offline: return r.abort("internetdisconnected")
    body = r.request.post_data or "{}"
    r.fulfill(status=200, content_type="application/json", body=json.dumps(M.handle(json.loads(body))))

STORAGE_THROWS = """
(() => { const t = () => { throw new DOMException('blocked', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', { get: t, configurable: true }); })();"""

def open_page(b, init=None, width=390):
    ctx = b.new_context(viewport={"width": width, "height": 844}, service_workers="block")
    if init: ctx.add_init_script(init)
    ctx.route("https://script.google.com/**", route)
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.abort())
    ctx.route("https://fonts.gstatic.com/**", lambda r: r.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); return ctx, pg, errs

T = 3000
def li_text(pg): return pg.locator("[data-li]").all_inner_texts()
def go_list(pg): pg.click("a[data-tab=list]", timeout=T); pg.wait_for_selector("#addform", timeout=T)
def add(pg, name, qty=""):
    pg.fill("#add-item", name, timeout=T)
    if qty: pg.fill("#add-qty", qty)
    pg.click("#add-go", timeout=T)
def item_id(pg, name):
    for el in pg.locator("[data-li]").all():
        if el.locator(".iname").inner_text().strip() == name: return el.get_attribute("data-li")
    return None
def settle(pg): pg.wait_for_timeout(400)

with sync_playwright() as p:
    b = p.chromium.launch()
    # --- viewer 1: John ---
    c1, a, err1 = open_page(b)
    check("first open asks who's on this phone", lambda: a.wait_for_selector("[data-me=John]", timeout=T))
    try: a.click("[data-me=John]", timeout=T)
    except Exception: pass
    check("recipes load from the endpoint (no Claude)", lambda: a.wait_for_selector("[data-recipe=OKO]", timeout=T))
    check("five tabs, List among them", lambda: a.locator("nav.tabs a").count() == 5 and a.locator("a[data-tab=list]").count() == 1)
    try: go_list(a)
    except Exception: pass
    check("empty list shows the empty state", lambda: "list is empty" in a.inner_text("#app", timeout=T))
    check("Add is disabled until an item is typed", lambda: a.is_disabled("#add-go", timeout=T))
    check("handler is guarded too (submit with blank does nothing)", lambda: (a.eval_on_selector("#addform", "f => f.requestSubmit()"), settle(a), not [c for c in M.calls if c.get("action") == "add"])[2])
    add_ok = True
    try: add(a, "Milk", "1 gal"); settle(a)
    except Exception: add_ok = False
    check("add writes to the endpoint with the viewer's name", lambda: add_ok and any(c.get("action") == "add" and c.get("by") == "John" and c["items"][0]["item"] == "Milk" for c in M.calls))
    check("added item shows under its section", lambda: a.locator("[data-lsec='Dairy & eggs'] [data-li]").count() == 1)
    check("temporary id swapped for the sheet's id", lambda: item_id(a, "Milk") == "G0001")
    try: add(a, "Cabbage"); settle(a)
    except Exception: pass
    check("section guessed from the Pantry (Cabbage -> Produce)", lambda: M.list[1]["Section"] == "Produce")
    check("no section picker on the add form (sections are guessed)", lambda: a.locator("#add-sec").count() == 0)
    try: add(a, "Bread"); settle(a)
    except Exception: pass
    check("a new everyday item is sorted without asking (Bread -> Bakery)", lambda: any(r["Item"] == "Bread" and r["Section"] == "Bakery" for r in M.list))
    check("Bread shows under Bakery on screen", lambda: a.locator("[data-lsec='Bakery'] [data-li]").count() == 1)
    check("duplicate refused locally", lambda: (add(a, "milk"), settle(a), sum(1 for r in M.list if r["Item"].lower() == "milk") == 1)[2])
    # --- viewer 2: Courtney, on her own phone ---
    c2, cpg, err2 = open_page(b)
    try: cpg.click("[data-me=Courtney]", timeout=T); go_list(cpg)
    except Exception: pass
    check("second viewer sees John's items", lambda: cpg.locator("[data-li]").count() == 3)
    check("second viewer sees who added it", lambda: "John" in cpg.inner_text("[data-li='G0001']", timeout=T))
    try: cpg.check("[data-ltick='G0002']", timeout=T); settle(cpg)
    except Exception: pass
    check("tick by Courtney lands on the right row", lambda: M.list[1]["Done"] == "yes" and M.list[1]["Done by"] == "Courtney")
    try: a.click("[data-lrefresh]", timeout=T); settle(a)
    except Exception: pass
    check("John sees Courtney's tick after refresh, with her name", lambda: a.is_checked("[data-ltick='G0002']") and "Courtney" in a.inner_text("[data-li='G0002']"))
    check("ticked item sorts below open ones in its section", lambda: a.locator("[data-li='G0002'].got").count() == 1)
    try: a.click("[data-lclear]", timeout=T); settle(a)
    except Exception: pass
    check("clear hides ticked items on both sides", lambda: M.list[1]["Cleared"] and a.locator("[data-li='G0002']").count() == 0)
    # --- usuals ---
    try: a.click("[data-lopen='G0001']", timeout=T); a.click("[data-lstar='G0001']", timeout=T); settle(a)
    except Exception: pass
    check("star puts an item in usuals", lambda: any(u["Item"] == "Milk" for u in M.usual))
    try:
        if not a.locator("[data-lremove='G0001']").count(): a.click("[data-lopen='G0001']", timeout=T)  # detail stays open after a star
        a.click("[data-lremove='G0001']", timeout=T); settle(a)
    except Exception: pass
    check("remove takes it off the list", lambda: M.list[0]["Cleared"] and a.locator("[data-li='G0001']").count() == 0)
    try:
        if a.locator("details[data-usuals]:not([open]) summary").count(): a.click("details[data-usuals] summary")
        a.click("[data-uadd='Milk']", timeout=T); settle(a)
    except Exception: pass
    check("one tap re-adds a usual", lambda: any(r["Item"] == "Milk" and not r["Cleared"] for r in M.list))
    # --- offline: add and tick with no signal, then the queue flushes ---
    M.offline = True
    try: add(a, "Lemons", "2"); settle(a)
    except Exception: pass
    check("offline add shows on the list at once", lambda: item_id(a, "Lemons") is not None and item_id(a, "Lemons").startswith("tmp-"))
    check("offline: status says a change is waiting", lambda: a.get_attribute("[data-liststatus]", "data-pending", timeout=T) == "1")
    try: a.check(f"[data-ltick='{item_id(a, 'Lemons')}']", timeout=T); settle(a)
    except Exception: pass
    check("offline tick queued behind the add", lambda: a.get_attribute("[data-liststatus]", "data-pending") == "2")
    M.offline = False
    try: a.click("[data-lrefresh]", timeout=T); a.wait_for_function("document.querySelector('[data-liststatus]').dataset.pending === '0'", timeout=6000)
    except Exception: pass
    check("back online: queue flushed in order, tick hit the real id", lambda: any(r["Item"] == "Lemons" and r["Done"] == "yes" for r in M.list))
    check("no temporary ids left on screen", lambda: not any((x or "").startswith("tmp-") for x in [e.get_attribute("data-li") for e in a.locator("[data-li]").all()]))
    # --- push from a recipe (Shop) ---
    try:
        a.click("a[data-tab=shop]", timeout=T); a.wait_for_selector("[data-send-grocery]", timeout=T)
        a.click("[data-send-grocery]"); settle(a)
    except Exception: pass
    check("Shop sends a recipe's items to the shared list", lambda: any(r["Item"] == "Pork belly, thin-sliced" and r["Section"] == "Meat & seafood" for r in M.list))
    check("Pantry 'Home staples'/'Refrigerated' sections map to store sections", lambda: next(r for r in M.list if r["Item"] == "Eggs")["Section"] == "Deli & fridge")
    n_before = len(M.list)
    try: a.click("[data-send-grocery]", timeout=T); settle(a)
    except Exception: pass
    check("sending again skips what's already on the list", lambda: len(M.list) == n_before)
    # --- stores: Andronico's by default, Nijiya from the recipe, filter by store (owner, 2026-11-13) ---
    check("a typed item goes to Andronico's", lambda: next(r for r in M.list if r["Item"] == "Milk")["Store"] == "Andronico's")
    check("Shop: a Nijiya pantry item is sent as Nijiya", lambda: next(r for r in M.list if r["Item"] == "Pork belly, thin-sliced")["Store"] == "Nijiya")
    check("Shop: an 'Any grocery' pantry item is sent as Andronico's", lambda: next(r for r in M.list if r["Item"] == "Eggs")["Store"] == "Andronico's")
    try: go_list(a); a.click("[data-lstore='Nijiya']", timeout=T); settle(a)
    except Exception: pass
    def only_nijiya():
        names = [e.inner_text().strip() for e in a.locator("[data-li] .iname").all()]
        want = sorted(r["Item"] for r in M.list if not r["Cleared"] and r["Store"] == "Nijiya")
        return sorted(names) == want and len(want) >= 3
    check("Nijiya filter shows only the Nijiya items", only_nijiya)
    try: add(a, "Kewpie mayonnaise refill"); settle(a)
    except Exception: pass
    check("adding while viewing Nijiya puts the item on the Nijiya list", lambda: next(r for r in M.list if r["Item"] == "Kewpie mayonnaise refill")["Store"] == "Nijiya")
    try: a.click("[data-lstore=\"Andronico's\"]", timeout=T); settle(a)
    except Exception: pass
    check("Andronico's filter hides the Nijiya items", lambda: "Pork belly, thin-sliced" not in a.inner_text("#app") and "Eggs" in a.inner_text("#app"))
    try: a.click("[data-lstore='All']", timeout=T); settle(a)
    except Exception: pass
    check("All shows both stores again", lambda: "Pork belly, thin-sliced" in a.inner_text("#app") and "Eggs" in a.inner_text("#app"))
    # --- log: cook number and save ---
    try: a.click("a[data-tab=log]", timeout=T); a.wait_for_selector("#lg-n", timeout=T)
    except Exception: pass
    check("Cook # suggests highest cook + 1 (ISS-071): 4", lambda: a.input_value("#lg-n", timeout=T) == "4")
    try:
        a.fill("#lg-happened", "Crisp, thin, good sauce"); a.fill("#lg-her", "Loved it"); a.click("#lg-save"); settle(a); settle(a)
    except Exception: pass
    check("log saves a 9-value Cooks row through the endpoint", lambda: M.cooks[-1][4] == "Crisp, thin, good sauce" and M.cooks[-1][8] == "OKO" and len(M.cooks[-1]) == 9)
    check("Courtney sees the same screens (Log with her reactions)", lambda: (cpg.click("a[data-tab=log]", timeout=T), cpg.click("[data-refresh]", timeout=T), settle(cpg), "Very good" in cpg.inner_text("#app"))[3])
    # --- phone width ---
    for name, pg in (("List", a), ("Log", a)):
        try: pg.click(f"a[data-tab={name.lower()}]", timeout=T); settle(pg)
        except Exception: pass
        check(f"390 px: no horizontal scroll on {name}", lambda: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    check("no page errors (John)", lambda: not err1)
    check("no page errors (Courtney)", lambda: not err2)
    # --- slow list read in flight while adding (live bug 2026-11-12: the item vanished until the save finished) ---
    SLOW_STATE = """(() => { const f = window.fetch.bind(window);
      window.fetch = async (u, o) => { const r = await f(u, o);
        try { if (window.__slowState && o && JSON.parse(o.body).action === 'state') { const t = await r.clone().text();
          await new Promise(z => setTimeout(z, 1200)); return new Response(t, {status: r.status, headers: {'Content-Type': 'application/json'}}); } } catch (e) {}
        return r; }; })();"""
    c4, sl, err4 = open_page(b, init=SLOW_STATE + "localStorage.setItem('teppan:me', JSON.stringify('John'));")
    missing = None
    try:
        sl.wait_for_selector("[data-recipe=OKO]", timeout=T); go_list(sl)
        sl.evaluate("window.__slowState = true")
        sl.click("[data-lrefresh]", timeout=T)            # a slow read starts, without the new item
        sl.wait_for_timeout(100)
        add(sl, "Butter")
        missing = sl.evaluate("""async () => { let gone = 0; for (let i = 0; i < 35; i++) {
            if (![...document.querySelectorAll('[data-li] .iname')].some(e => e.textContent.trim() === 'Butter')) gone++;
            await new Promise(z => setTimeout(z, 100)); } return gone; }""")
    except Exception:
        pass
    check("an item added while a slow list read is in flight never disappears", lambda: missing == 0)
    check("no page errors (slow read)", lambda: not err4)
    # --- storage throwing ---
    c3, s, err3 = open_page(b, init=STORAGE_THROWS)
    try: s.click("[data-me=John]", timeout=T); go_list(s); add(s, "Rice"); settle(s)
    except Exception: pass
    check("works with browser storage throwing (add lands)", lambda: any(r["Item"] == "Rice" for r in M.list))
    try: s.click("[data-lstore='Nijiya']", timeout=T); settle(s)
    except Exception: pass
    check("store filter works with browser storage throwing", lambda: s.get_attribute("[data-lstore='Nijiya']", "aria-pressed", timeout=T) == "true" and "Rice" not in s.inner_text("#app"))
    check("no page errors with storage throwing", lambda: not err3)
    b.close()
srv.shutdown()
bad = [n for ok, n in results if not ok]
print(f"\n{len(results) - len(bad)} of {len(results)} checks pass ({PAGE})")
sys.exit(1 if bad else 0)
