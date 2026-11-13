/* ---------- endpoint (CS-066) ---------- */
async function api(p, ms){
  if(!API_URL || /PASTE/.test(API_URL)) throw {offline:false, message:"The app isn't connected to its endpoint yet."};
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 25000);
  let res;
  try{
    res = await fetch(API_URL, {method:"POST", body: JSON.stringify(p), headers:{"Content-Type":"text/plain;charset=utf-8"}, redirect:"follow", signal: ctl.signal});
  }catch(e){ throw {offline:true, message: navigator.onLine === false ? "No signal." : "Couldn't reach the list. Check your signal."}; }
  finally{ clearTimeout(t); }
  let j = null;
  try{ j = await res.json(); }catch{ throw {offline:true, message:"The list answered with something unexpected (" + res.status + ")."}; }
  if(!j || !j.ok) throw {offline:false, message: (j && j.error) || "The list reported a problem."};
  return j;
}
function errText(e){ return (e && e.message) ? e.message : "Something went wrong."; }

/* ---------- who's on this phone ---------- */
let meMem = null;
function me(){ return store.get("me", null) || meMem; }
function setMe(n){ meMem = n; store.set("me", n); }
function askMe(then){
  $app.innerHTML = `<div class="view"><header class="top"><h1>Teppan Cookbook</h1></header>
    <div class="card"><h2>Who's using this phone?</h2><p class="muted">Your name goes on what you add and tick, so the other person can see who did it.</p>
    <div class="row-wrap">${PEOPLE.map(n => `<button class="btn" data-me="${esc(n)}">${esc(n)}</button>`).join("")}</div></div></div>`;
  $app.querySelectorAll("[data-me]").forEach(b => b.onclick = () => { setMe(b.dataset.me); then(); });
}

/* ---------- shared grocery list: optimistic, queued, works offline ---------- */
let Q = null;            // pending changes, oldest first; kept in memory, mirrored to storage
let flushing = false, listAt = null;
let listGen = 0;        // bumped on every local change and every saved change; a list read that started before a bump is stale and is dropped
function qLoad(){ if(Q === null) Q = store.get("queue", []) || []; return Q; }
function qSave(){ store.set("queue", Q); }
function pending(){ return qLoad().length; }
function tmpId(){ return "tmp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function norm(s){ return String(s || "").trim().toLowerCase(); }
function openOnList(name){ return (L ? L.list : []).find(x => !x.Done && !x.Cleared && norm(x.Item) === norm(name)); }
function stamp(){ return new Date().toISOString(); }

// Apply one change to the local list (used when queued, and again after a refresh while changes are still waiting).
function applyLocal(op){
  if(!L) return;
  if(op.op === "add"){
    op.items.forEach(it => { if(openOnList(it.item)) return; L.list.push({ID: it.tmp, Item: it.item, Qty: it.qty || "", Section: sectionFor(it.section), Store: it.store || "", Note: it.note || "", "Added by": op.by, Added: op.at, Done:"", "Done by":"", "Done at":"", Cleared:""}); });
  } else if(op.op === "tick"){
    const x = L.list.find(y => y.ID === op.id); if(x){ x.Done = op.done ? "yes" : ""; x["Done by"] = op.done ? op.by : ""; x["Done at"] = op.done ? op.at : ""; }
  } else if(op.op === "remove"){
    L.list = L.list.filter(y => y.ID !== op.id);
  } else if(op.op === "clear"){
    L.list = L.list.filter(y => !y.Done);
  } else if(op.op === "usual"){
    const i = L.usual.findIndex(u => norm(u.Item) === norm(op.item));
    if(op.star){ const u = {ID: i >= 0 ? L.usual[i].ID : op.tmp, Item: op.item, Qty: op.qty || "", Section: sectionFor(op.section), Store: op.store || ""}; if(i >= 0) L.usual[i] = u; else L.usual.push(u); }
    else if(i >= 0) L.usual.splice(i, 1);
  }
}
function enqueue(op){
  op.at = stamp(); op.by = me() || "";
  qLoad().push(op); qSave(); listGen++;
  applyLocal(op); cacheList();
  flush();
}
function sectionFor(name){
  const n = norm(name); if(!n || !L) return name || "";
  for(const s of L.sections){
    if(norm(s.Section) === n) return s.Section;
    if(String(s.Aliases || "").split(",").map(norm).filter(Boolean).includes(n)) return s.Section;
  }
  return name;
}
function cacheList(){ if(L) store.set("list", {L, at: listAt ? listAt.toISOString() : null}); }

async function flush(){
  if(flushing || !pending()) { updateListStatus(); return; }
  flushing = true; updateListStatus();
  try{
    while(qLoad().length){
      const op = Q[0];
      let res;
      try{
        if(op.op === "add") res = await api({action:"add", by: op.by, items: op.items});
        else if(op.op === "tick") res = await api({action:"tick", id: op.id, done: op.done, by: op.by});
        else if(op.op === "remove") res = await api({action:"remove", id: op.id});
        else if(op.op === "clear") res = await api({action:"clear"});
        else if(op.op === "usual") res = await api({action:"usual", item: op.item, qty: op.qty, section: op.section, store: op.store, star: op.star});
      }catch(e){
        if(e && e.offline) break;                        // keep it; try again when the signal is back
        toast("Couldn't save a change: " + errText(e));    // the server refused it: drop it so the rest can go
      }
      Q.shift(); listGen++;
      if(op.op === "add" && res && res.map){             // swap temporary ids for the real ones everywhere
        Object.entries(res.map).forEach(([t, id]) => {
          Q.forEach(o => { if(o.id === t) o.id = id; });
          if(L) L.list.forEach(x => { if(x.ID === t) x.ID = id; });
        });
      }
      qSave();
    }
  } finally {
    flushing = false;
    if(!pending()) await refreshList(true);
    updateListStatus();
  }
}
async function refreshList(quiet){
  if(pending() || flushing) return;
  const gen = listGen;
  try{
    const s = await api({action:"state"}, 20000);
    if(gen !== listGen || pending() || flushing) return;   // a change happened while this read was in flight
    L = {list: s.list, usual: s.usual, sections: s.sections}; listAt = new Date(); cacheList();
    if(route() === "list") viewList();
  }catch(e){ if(!quiet) toast(errText(e)); updateListStatus(); }
}
function updateListStatus(){
  const el = document.querySelector("[data-liststatus]"); if(!el) return;
  const n = pending();
  const t = listAt ? listAt.toLocaleTimeString(undefined, {hour:"numeric", minute:"2-digit"}) : "not yet";
  el.textContent = n ? `${n} change${n===1?"":"s"} waiting to save${flushing ? "…" : " (no signal?)"}` : `Synced ${t}`;
  el.dataset.pending = String(n);
}

// Best guess at a section for a typed item: same name on the list before, a usual, or a Pantry item.
function guessSection(name){
  const n = norm(name); if(!n) return "";
  const hit = (L ? [...L.list, ...L.usual] : []).find(x => norm(x.Item) === n && x.Section);
  if(hit) return hit.Section;
  const p = D && D.pantry.find(x => norm(x.item) === n);
  return p ? sectionFor(p.section) : "";
}

function viewList(){
  if(!L){ $app.innerHTML = `<div class="view">${listTop()}<p class="empty">The list hasn't loaded yet. It needs a signal the first time.</p></div>`; wireListTop(); return; }
  const open = store.get("listOpen", null);
  const secs = [...L.sections].sort((a,b) => a.Order - b.Order).map(s => s.Section);
  const known = new Set(secs);
  const items = L.list.filter(x => !x.Cleared);
  const groups = [...secs, "Other"].map(s => {
    const its = items.filter(x => (known.has(x.Section) ? x.Section : "Other") === s).sort((a,b) => (a.Done?1:0) - (b.Done?1:0));
    if(!its.length) return "";
    return `<div class="card sh-sec" data-lsec="${esc(s)}"><h3 style="margin-bottom:6px">${esc(s)}</h3>${its.map(x => {
      const isOpen = open === x.ID;
      const meta = [x.Qty, x.Store].filter(Boolean).join(" · ");
      return `<div class="item ${x.Done?"got":""}" data-li="${esc(x.ID)}">
        <input type="checkbox" data-ltick="${esc(x.ID)}" ${x.Done?"checked":""} aria-label="Got ${esc(x.Item)}">
        <button class="stxt" data-lopen="${esc(x.ID)}"><span class="iname">${esc(x.Item)}</span>${meta?` <span class="muted small">${esc(meta)}</span>`:""}${x.Note && !isOpen?`<div class="where">${esc(x.Note.length > 70 ? x.Note.slice(0,70) + "…" : x.Note)}</div>`:""}</button>
        <span class="amt small muted">${x.Done && x["Done by"] && x["Done by"] !== me() ? esc(x["Done by"]) : (!x.Done && x["Added by"] && x["Added by"] !== me() ? esc(x["Added by"]) : "")}</span>
        ${isOpen ? `<div class="more" style="grid-column:2 / -1;margin-top:6px" data-ldetail="${esc(x.ID)}">
          ${x.Note?`<p>${esc(x.Note)}</p>`:""}
          <p class="small muted">Added by ${esc(x["Added by"] || "someone")}${x.Added?` · ${esc(when(x.Added))}`:""}${x.Done?` · got by ${esc(x["Done by"] || "someone")}`:""}</p>
          <div class="row-wrap"><button class="iconbtn" data-lstar="${esc(x.ID)}">${isUsual(x.Item) ? "★ In usuals" : "☆ Add to usuals"}</button><button class="iconbtn" data-lremove="${esc(x.ID)}">Remove</button></div></div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }).join("");
  const done = items.filter(x => x.Done).length;
  const usualChips = L.usual.length ? `<details class="sec" data-usuals ${store.get("usualsOpen", false)?"open":""}><summary><h2>Usuals</h2><span class="cnt">${L.usual.length}</span></summary><div class="sec-body"><p class="small muted" style="margin:0 0 8px">Tap to put one on the list. Star an item on the list to add it here.</p><div class="row-wrap">${L.usual.map(u => {
      const on = !!openOnList(u.Item);
      return `<button class="chip ${on?"nori":""}" data-uadd="${esc(u.Item)}" ${on?"disabled":""}>${on?"✓ ":"+ "}${esc(u.Item)}</button>`;
    }).join("")}</div></div></details>` : "";
  const draft = store.get("addDraft", "");
  $app.innerHTML = `<div class="view">${listTop()}
    <form class="card" id="addform" novalidate>
      <label class="f" for="add-item" style="margin-top:0">Add to the list</label>
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px"><input id="add-item" type="text" autocomplete="off" enterkeyhint="done" placeholder="Milk, 2 lemons, paper towels…" value="${esc(draft)}"><button class="btn" id="add-go" type="submit" ${draft.trim()?"":"disabled"}>Add</button></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <input id="add-qty" type="text" placeholder="Amount" autocomplete="off">
        <select id="add-sec" aria-label="Section"><option value="">Section: guess</option>${secs.map(s => `<option>${esc(s)}</option>`).join("")}</select></div>
    </form>
    ${usualChips}
    ${groups || `<p class="empty">The list is empty. Add something above, or send a recipe's items from Shop.</p>`}
    ${done ? `<p style="text-align:center"><button class="iconbtn" data-lclear>Clear ${done} ticked item${done===1?"":"s"}</button></p>` : ""}
    <p class="small muted" style="text-align:center">This phone: ${esc(me() || "not set")} · <button class="back" data-changeme>change</button></p></div>`;
  wireListTop();
  const f = $app.querySelector("#addform"), inp = f.querySelector("#add-item"), go = f.querySelector("#add-go");
  inp.addEventListener("input", () => { store.set("addDraft", inp.value); go.disabled = !inp.value.trim(); });
  f.onsubmit = e => {
    e.preventDefault();
    const name = inp.value.trim(); if(!name) return;   // guard the handler as well as the button
    if(openOnList(name)){ toast(`${name} is already on the list.`); return; }
    const sec = f.querySelector("#add-sec").value || guessSection(name);
    enqueue({op:"add", items:[{item:name, qty:f.querySelector("#add-qty").value.trim(), section:sec, store:"", note:"", tmp: tmpId()}]});
    store.set("addDraft", ""); viewList();
    const again = $app.querySelector("#add-item"); if(again) again.focus();
  };
  $app.querySelectorAll("[data-ltick]").forEach(c => c.onchange = () => { enqueue({op:"tick", id:c.dataset.ltick, done:c.checked}); viewList(); });
  $app.querySelectorAll("[data-lopen]").forEach(b => b.onclick = () => { store.set("listOpen", open === b.dataset.lopen ? null : b.dataset.lopen); viewList(); });
  $app.querySelectorAll("[data-lremove]").forEach(b => b.onclick = () => { enqueue({op:"remove", id:b.dataset.lremove}); store.set("listOpen", null); viewList(); });
  $app.querySelectorAll("[data-lstar]").forEach(b => b.onclick = () => {
    const x = L.list.find(y => y.ID === b.dataset.lstar); if(!x) return;
    const star = !isUsual(x.Item);
    enqueue({op:"usual", item:x.Item, qty:x.Qty, section:x.Section, store:x.Store, star, tmp: tmpId()}); viewList();
  });
  $app.querySelectorAll("[data-uadd]").forEach(b => b.onclick = () => {
    const u = L.usual.find(y => y.Item === b.dataset.uadd); if(!u || openOnList(u.Item)) return;
    enqueue({op:"add", items:[{item:u.Item, qty:u.Qty, section:u.Section, store:u.Store, note:"", tmp: tmpId()}]}); viewList();
  });
  const us = $app.querySelector("[data-usuals]"); if(us) us.addEventListener("toggle", () => store.set("usualsOpen", us.open));
  const cl = $app.querySelector("[data-lclear]"); if(cl) cl.onclick = () => { enqueue({op:"clear"}); viewList(); };
  $app.querySelector("[data-changeme]").onclick = () => askMe(() => { location.hash = "list"; render(); });
}
function isUsual(name){ return !!(L && L.usual.find(u => norm(u.Item) === norm(name))); }
function when(iso){ const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(undefined, {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}); }
function listTop(){
  return `<header class="top"><div><h1>Groceries</h1><div class="muted small">Shared with ${esc(PEOPLE.filter(n => n !== me()).join(", ") || "the household")}.</div></div>
    <div class="sync"><span data-liststatus></span><button class="iconbtn" data-lrefresh>Refresh</button></div></header>`;
}
function wireListTop(){ const b = $app.querySelector("[data-lrefresh]"); if(b) b.onclick = () => { if(pending()) flush(); else refreshList(false); }; updateListStatus(); }

// Keep the list live while it's on screen: re-read every 20 s, and right away when the page comes back.
setInterval(() => { if(document.visibilityState === "visible" && route() === "list" && !pending()) refreshList(true); else if(pending()) flush(); }, 20000);
window.addEventListener("online", () => flush());
