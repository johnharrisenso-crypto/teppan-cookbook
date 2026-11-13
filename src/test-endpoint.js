// Runs Code.gs against an in-memory fake of SpreadsheetApp, LockService and ContentService.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
function mkSheet(name, rows){
  let data = rows.map(r => r.slice()), fmt = {};
  const s = {
    getName: () => name,
    getLastRow: () => { for (let i = data.length - 1; i >= 0; i--) if ((data[i] || []).some(c => String(c) !== "")) return i + 1; return 0; },
    getDataRange: () => s.getRange(1, 1, Math.max(1, s.getLastRow()), Math.max(1, ...data.map(r => r.length))),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getDisplayValues: () => { const out = []; for (let i = 0; i < nr; i++){ const row = []; for (let j = 0; j < nc; j++) row.push(String(((data[r-1+i] || [])[c-1+j]) ?? "").replace(/^'/, "")); out.push(row); } return out; },
      setValues: v => { assert.strictEqual(v.length, nr); v.forEach((row, i) => { assert.strictEqual(row.length, nc); data[r-1+i] = data[r-1+i] || []; row.forEach((x, j) => { if (!fmt[(r+i)+":"+(c+j)] && /^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error("date written without text format at " + (r+i) + ":" + (c+j)); data[r-1+i][c-1+j] = x; }); }); },
      setValue: x => s.getRange(r, c).setValues([[x]]),
      setNumberFormat: f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fmt[(r+i)+":"+(c+j)] = f; }
    }),
    appendRow: row => { data.push(row); },
    deleteRow: r => { data.splice(r - 1, 1); },
    _data: () => data
  };
  return s;
}
const LIST_HEAD = ["ID","Item","Qty","Section","Store","Note","Added by","Added","Done","Done by","Done at","Cleared"];
const grocery = {
  List: mkSheet("List", [LIST_HEAD]),
  Usual: mkSheet("Usual", [["ID","Item","Qty","Section","Store"]]),
  Sections: mkSheet("Sections", [["Section","Order","Aliases"],["Produce","1","Produce"],["Meat & seafood","2","Meat"],["Dry goods","5","Dry goods, Home staples"]])
};
const cooks = mkSheet("Cooks", [["Date","Recipe","Cook #","What I changed from last time","What happened","Her reaction","My score (1-5)","Next time try","Recipe ID"]]);
const cooking = { Recipes: mkSheet("Recipes", [["ID"]]), Ingredients: mkSheet("Ingredients", [["Recipe"]]), Steps: mkSheet("Steps", [["Recipe"]]), Pantry: mkSheet("Pantry", [["#"]]), Glossary: mkSheet("Glossary", [["Term"]]), Cooks: cooks };
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => grocery[n] || null }), openById: id => ({ getSheetByName: n => (id === "1KxlIa3BW6oNmaBci59vc5kcs3fVxswmQpJEHcLd1OZo" ? grocery : cooking)[n] || null }) },
  LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
  ContentService: { MimeType: {JSON: "json"}, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
  Date, JSON, String, Number, Object, Math, Error
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2] || __dirname + "/Code.gs", "utf8"), ctx);
const call = p => JSON.parse(ctx.doPost({postData: {contents: JSON.stringify(p)}}).text);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(!/\bKEY\b|p\.key|H4Dc/.test(fs.readFileSync(process.argv[2] || __dirname + "/Code.gs", "utf8")), "no access key in the code");
ok(call({action: "ping"}).version === 2, "ping v2");
let r = call({action: "add", by: "John", items: [{item: "Eggs", qty: "12", section: "Refrigerated and pickles", tmp: "t1"}, {item: "Cabbage", section: "Produce"}, {item: "=SUM(1)"}]});
ok(r.ok && r.added.length === 3, "add 3: " + JSON.stringify(r));
ok(r.map.t1 === "G0001", "tmp id mapped");
ok(grocery.List._data()[3][1] === "'=SUM(1)", "formula guarded");
ok(r.added[1].Section === "Produce", "section kept");
r = call({action: "add", by: "Courtney", items: [{item: "eggs", tmp: "t2"}, {item: "Rice", section: "Home staples"}]});
ok(r.skipped.length === 1 && r.map.t2 === "G0001", "duplicate skipped and mapped");
ok(r.added[0].ID === "G0004" && r.added[0].Section === "Dry goods", "alias maps Home staples to Dry goods");
r = call({action: "tick", id: "G0002", done: true, by: "Courtney"});
ok(r.ok && r.row.Done === "yes" && r.row["Done by"] === "Courtney", "tick");
ok(call({action: "tick", id: "G9999", done: true}).ok === false, "tick missing row");
r = call({action: "state"});
ok(r.list.length === 4 && !r.raw, "state without cooking");
r = call({action: "clear"});
ok(r.cleared === 1, "clear ticked");
ok(call({action: "state"}).list.length === 3, "cleared row hidden");
r = call({action: "add", items: [{item: "Cabbage"}]});
ok(r.added.length === 1, "re-add after clear works (old one cleared)");
r = call({action: "remove", id: "G0003"});
ok(r.ok && call({action: "state"}).list.every(x => x.ID !== "G0003"), "remove");
r = call({action: "usual", item: "Milk", qty: "1 gal", section: "Dairy", star: true});
ok(r.usual.length === 1 && r.usual[0].ID === "U001", "usual add");
r = call({action: "usual", item: "milk", qty: "half gal", star: true});
ok(r.usual.length === 1 && r.usual[0].Qty === "half gal", "usual update by name");
r = call({action: "usual", item: "Milk", star: false});
ok(r.usual.length === 0, "usual remove");
r = call({action: "state", recipes: true});
ok(r.raw && Object.keys(r.raw).length === 6 && r.raw.Cooks[0][2] === "Cook #", "state with cooking raw tabs");
r = call({action: "log", row: ["2026-11-11","Okonomiyaki v2","4","x","good","Loved it","5","more sauce","OKO"]});
ok(r.ok && r.row === 2, "log appended with read-back: " + JSON.stringify(r));
ok(call({action: "log", row: ["a"]}).ok === false, "log row length checked");
r = call({action: "log", row: ["2026-11-12","Okonomiyaki v2","5","","'- crisp edges","","","","OKO"]});
ok(r.ok, "log entry starting with a hyphen reads back as saved: " + JSON.stringify(r));
grocery.List._data()[0][3] = "Aisle";
ok(/column D should be "Section"/.test(call({action: "state"}).error), "header moved is reported");
console.log("PASS " + n + " checks");
