/**
 * Teppan Cookbook endpoint, version 3 (CS-066, 2026-11-14). Version 2: 2026-11-11.
 * Version 3 adds the "move" action (change an item's section and/or store) and the
 * Learned tab (item, section, store), which every move updates and the app reads
 * first when it places a newly added item.
 * A standalone Google Apps Script web app (project "Teppan Cookbook endpoint") that opens
 * the "Grocery list" Sheet in Spine/Cooking by its ID.
 * It runs as the owner, so the Teppan Cookbook app on any phone can read the
 * cooking data and read and write the grocery list without a Google or Claude
 * sign-in. Cooking data is a separate Sheet; this script reads all of its app
 * tabs and appends only to Cooks (the cook log).
 *
 * Deploy: Deploy > New deployment > type Web app, Execute as "Me",
 * Who has access "Anyone". After any edit to this file: Deploy > Manage
 * deployments > pencil > Version "New version" > Deploy (the /exec URL stays).
 *
 * No access key (owner decided 2026-11-11): a key would sit in the app's public
 * page anyway, so the long random /exec URL is the only gate. Anyone with the
 * app's link can read the recipes and read and edit the list (owner accepted).
 *
 * Version 2 changes from version 1 (2026-11-06, never deployed):
 *  - state with recipes:true returns the cooking tabs as raw rows (header
 *    first) so the app checks headers itself, plus Glossary and Cooks.
 *  - new action "log": appends one Cooks row with read-back.
 *  - every written range is set to plain text first, so dates and times stay
 *    as typed (Sheets would otherwise turn 2026-11-11 into a date).
 */
var COOKING_ID = "1PQas1S5aXxoIXJlkSt1e-9BhjS0KEXLjEPqoL6T9ZZo"; // Cooking data
var GROCERY_ID = "1KxlIa3BW6oNmaBci59vc5kcs3fVxswmQpJEHcLd1OZo"; // Grocery list (a standalone script opens it by ID)

// Grocery list tabs, by position (new columns go at the end).
var LIST_HEAD = ["ID","Item","Qty","Section","Store","Note","Added by","Added","Done","Done by","Done at","Cleared"];
var USUAL_HEAD = ["ID","Item","Qty","Section","Store"];
var LEARNED_HEAD = ["Item","Section","Store","Updated"];   // optional tab; missing = nothing learned yet
// Cooking data tabs the app reads, with their widths. The app checks the headers.
var COOK_TABS = {Recipes:13, Ingredients:11, Steps:8, Pantry:12, Glossary:4, Cooks:9};
var COOKS_HEAD = ["Date","Recipe","Cook #",null,null,"Her reaction",null,"Next time try","Recipe ID"];

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.p) { try { q = JSON.parse(q.p); } catch (err) { return out({ok:false, error:"Bad JSON in p"}); } } // ?p={json} for checks that can only GET
  return handle(q);
}
function doPost(e) {
  var p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) { return out({ok:false, error:"Bad JSON"}); }
  return handle(p);
}

function handle(p) {
  try {
    var a = p.action || "state";
    if (a === "state") return out(state(!!p.recipes));
    if (a === "add") return out(withLock(function(){ return add(p.items || [], p.by); }));
    if (a === "tick") return out(withLock(function(){ return tick(p.id, p.done, p.by); }));
    if (a === "remove") return out(withLock(function(){ return remove(p.id); }));
    if (a === "clear") return out(withLock(function(){ return clearDone(); }));
    if (a === "usual") return out(withLock(function(){ return usual(p.item, p.qty, p.section, p.store, !!p.star); }));
    if (a === "log") return out(withLock(function(){ return logCook(p.row); }));
    if (a === "move") return out(withLock(function(){ return move(p.id, p.section, p.store); }));
    if (a === "ping") return out({ok:true, pong:true, version:3, at:now()});
    return out({ok:false, error:"Unknown action " + a});
  } catch (err) {
    return out({ok:false, error:String((err && err.message) || err)});
  }
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function now() { return new Date().toISOString(); }
function sheet(name) {
  var s = SpreadsheetApp.openById(GROCERY_ID).getSheetByName(name);
  if (!s) throw new Error("Tab " + name + " is missing");
  return s;
}
// Returns rows (without header) padded to the head's width; checks the header by position.
function readTab(s, head) {
  var w = head.length, last = s.getLastRow();
  var vals = last > 0 ? s.getRange(1, 1, last, w).getDisplayValues() : [[]];
  var h = vals[0] || [];
  for (var i = 0; i < w; i++) {
    if (head[i] != null && String(h[i] || "").trim() !== head[i])
      throw new Error(s.getName() + " column " + String.fromCharCode(65 + i) + " should be \"" + head[i] + "\" but reads \"" + (h[i] || "") + "\"");
  }
  return vals.slice(1).map(function(r){ while (r.length < w) r.push(""); return r; });
}
function rowObj(head, r) { var o = {}; head.forEach(function(k, i){ if (k != null) o[k] = r[i]; }); return o; }
// Plain-text write: format the target cells as text, then set the values.
function writeText(range, values) { range.setNumberFormat("@"); range.setValues(values); }
function safe(v) { v = String(v == null ? "" : v); return /^[=+\-@]/.test(v) ? "'" + v : v; } // never start a cell with a formula character

/* ---------- read ---------- */
function sections() {
  var v = sheet("Sections").getDataRange().getDisplayValues(), h = v[0] || [];
  if (String(h[0]).trim() !== "Section" || String(h[1]).trim() !== "Order") throw new Error("Sections header moved");
  return v.slice(1).filter(function(r){ return r[0]; }).map(function(r){ return {Section:r[0], Order:Number(r[1]) || 99, Aliases:String(r[2] || "")}; });
}
function state(includeCooking) {
  var list = readTab(sheet("List"), LIST_HEAD).map(function(r){ return rowObj(LIST_HEAD, r); }).filter(function(x){ return x.ID && !x.Cleared; });
  var usual = readTab(sheet("Usual"), USUAL_HEAD).map(function(r){ return rowObj(USUAL_HEAD, r); }).filter(function(x){ return x.ID; });
  var o = {ok:true, version:3, at:now(), list:list, usual:usual, sections:sections(), learned:learned()};
  if (includeCooking) {
    var ck = SpreadsheetApp.openById(COOKING_ID), raw = {};
    Object.keys(COOK_TABS).forEach(function(n){
      var s = ck.getSheetByName(n);
      if (!s) throw new Error("Cooking data tab " + n + " is missing");
      var last = Math.max(1, s.getLastRow());
      raw[n] = s.getRange(1, 1, last, COOK_TABS[n]).getDisplayValues();
    });
    o.raw = raw;
  }
  return o;
}

/* ---------- grocery list writes ---------- */
function nextNum(s, re) {
  var last = s.getLastRow(), max = 0;
  if (last > 1) s.getRange(2, 1, last - 1, 1).getDisplayValues().forEach(function(r){ var m = re.exec(r[0]); if (m) max = Math.max(max, Number(m[1])); });
  return max;
}
function sectionFor(name, secs) {
  var n = String(name || "").trim();
  if (!n) return "";
  for (var i = 0; i < secs.length; i++) {
    if (secs[i].Section.toLowerCase() === n.toLowerCase()) return secs[i].Section;
    var al = secs[i].Aliases.split(",").map(function(a){ return a.trim().toLowerCase(); }).filter(String);
    if (al.indexOf(n.toLowerCase()) >= 0) return secs[i].Section;
  }
  return n; // unknown section kept as typed; the app shows it under Other
}
// items: [{item, qty, section, store, note, tmp}]. Skips an item already open on the list (same name). Returns rows written, with each tmp id mapped to its new ID.
function add(items, by) {
  var s = sheet("List"), secs = sections();
  var open = {};
  readTab(s, LIST_HEAD).forEach(function(r){ if (r[0] && !r[8] && !r[11]) open[String(r[1]).trim().toLowerCase()] = r[0]; });
  var n = nextNum(s, /^G(\d+)$/), rows = [], skipped = [], map = {}, stamp = now();
  items.forEach(function(it){
    var name = String(it.item || "").trim();
    if (!name) return;
    var k = name.toLowerCase();
    if (open[k]) { skipped.push({item:name, id:open[k]}); if (it.tmp) map[it.tmp] = open[k]; return; }
    n += 1;
    var id = "G" + ("0000" + n).slice(-4);
    rows.push([id, safe(name), safe(it.qty), sectionFor(it.section, secs), safe(it.store), safe(it.note), safe(by), stamp, "", "", "", ""]);
    open[k] = id; if (it.tmp) map[it.tmp] = id;
  });
  if (rows.length) writeText(s.getRange(s.getLastRow() + 1, 1, rows.length, LIST_HEAD.length), rows);
  var ids = {}; rows.forEach(function(w){ ids[w[0]] = 1; });
  var back = readTab(s, LIST_HEAD).filter(function(r){ return ids[r[0]]; });
  if (back.length !== rows.length) throw new Error("Wrote " + rows.length + " but read back " + back.length);
  return {ok:true, added:back.map(function(r){ return rowObj(LIST_HEAD, r); }), skipped:skipped, map:map, at:stamp};
}
function findRow(s, id) {
  var last = s.getLastRow();
  if (last < 2 || !id) return 0;
  var ids = s.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}
function tick(id, done, by) {
  var s = sheet("List"), r = findRow(s, id);
  if (!r) return {ok:false, error:"No row " + id};
  var stamp = now();
  writeText(s.getRange(r, 9, 1, 3), [done ? ["yes", safe(by), stamp] : ["", "", ""]]);
  return {ok:true, row:rowObj(LIST_HEAD, s.getRange(r, 1, 1, LIST_HEAD.length).getDisplayValues()[0]), at:stamp};
}
function remove(id) {
  var s = sheet("List"), r = findRow(s, id);
  if (!r) return {ok:false, error:"No row " + id};
  var stamp = now();
  writeText(s.getRange(r, 12), [[stamp]]);
  return {ok:true, id:id, at:stamp};
}
// Marks every ticked row Cleared (soft delete; the row stays in the Sheet as history).
function clearDone() {
  var s = sheet("List"), rows = readTab(s, LIST_HEAD), stamp = now(), n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] && rows[i][8] && !rows[i][11]) { writeText(s.getRange(i + 2, 12), [[stamp]]); n++; }
  }
  return {ok:true, cleared:n, at:stamp};
}
// star=true adds (or updates) a usual; star=false removes it. Matched by item name.
function usual(item, qty, section, store, star) {
  var s = sheet("Usual"), name = String(item || "").trim();
  if (!name) return {ok:false, error:"No item"};
  var rows = readTab(s, USUAL_HEAD), hit = 0;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][1]).trim().toLowerCase() === name.toLowerCase()) { hit = i + 2; break; }
  if (star) {
    var vals = [safe(name), safe(qty), sectionFor(section, sections()), safe(store)];
    if (hit) writeText(s.getRange(hit, 2, 1, 4), [vals]);
    else {
      var at = s.getLastRow() + 1;
      writeText(s.getRange(at, 1, 1, 5), [["U" + ("000" + (nextNum(s, /^U(\d+)$/) + 1)).slice(-3)].concat(vals)]);
    }
  } else if (hit) {
    s.deleteRow(hit);
  }
  var after = readTab(s, USUAL_HEAD).map(function(r){ return rowObj(USUAL_HEAD, r); }).filter(function(x){ return x.ID; });
  return {ok:true, usual:after, at:now()};
}

/* ---------- move and learn ---------- */
function learnedSheet() { return SpreadsheetApp.openById(GROCERY_ID).getSheetByName("Learned"); }
function learned() {
  var s = learnedSheet();
  if (!s) return [];
  return readTab(s, LEARNED_HEAD).map(function(r){ return rowObj(LEARNED_HEAD, r); }).filter(function(x){ return x.Item; });
}
// Upsert one Learned row by item name (case-insensitive). Blank section or store keeps what was there.
function learn(item, section, store) {
  var s = learnedSheet(), name = String(item || "").trim();
  if (!s || !name) return;
  var rows = readTab(s, LEARNED_HEAD), hit = 0;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim().toLowerCase() === name.toLowerCase()) { hit = i + 2; break; }
  var old = hit ? rows[hit - 2] : ["", "", "", ""];
  var vals = [[safe(name), section || old[1], store || old[2], now()]];
  writeText(s.getRange(hit || s.getLastRow() + 1, 1, 1, 4), vals);
}
// Change an item's section and/or store (row found by ID), read it back, and remember it in Learned.
function move(id, section, store) {
  var s = sheet("List"), r = findRow(s, id);
  if (!r) return {ok:false, error:"No row " + id};
  section = section ? sectionFor(section, sections()) : "";
  store = store ? safe(String(store).trim()) : "";
  if (!section && !store) return {ok:false, error:"Nothing to move"};
  if (section) writeText(s.getRange(r, 4), [[section]]);
  if (store) writeText(s.getRange(r, 5), [[store]]);
  var back = rowObj(LIST_HEAD, s.getRange(r, 1, 1, LIST_HEAD.length).getDisplayValues()[0]);
  if ((section && back.Section !== section) || (store && back.Store !== store.replace(/^'/, ""))) throw new Error("Move written but did not read back the same");
  learn(back.Item, section, store);
  return {ok:true, row:back, at:now()};
}

/* ---------- cook log ---------- */
// row: the 9 Cooks values A:I in order. Appends, then reads back by Date, What happened and Recipe ID.
function logCook(row) {
  if (!row || row.length !== 9) return {ok:false, error:"A cook row needs 9 values"};
  var s = SpreadsheetApp.openById(COOKING_ID).getSheetByName("Cooks");
  if (!s) throw new Error("Cooks tab is missing");
  readTab(s, COOKS_HEAD); // header check
  var vals = [row.map(safe)];
  var at = s.getLastRow() + 1;
  writeText(s.getRange(at, 1, 1, 9), vals);
  var back = s.getRange(at, 1, 1, 9).getDisplayValues()[0];
  var shown = function(v){ return String(v).replace(/^'/, ""); }; // Sheets displays a guarded cell without its leading apostrophe
  var ok = [0, 4, 8].every(function(i){ return shown(back[i]) === shown(vals[0][i]); });
  if (!ok) throw new Error("Cook row written but did not read back the same");
  return {ok:true, row:at, at:now()};
}
