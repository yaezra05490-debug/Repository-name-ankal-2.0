/* בדיקות הלוגיקה של הקלטות השיחה (recordings-core.js): שמות קבצים מכמה טלפונים, מזהה קבוע, מיזוג סריקות
   לארכיון (כרטיס ומחשב), השלמה מאנשי קשר ויומן, סינון, סיכומים, פענוח תשובות AI, גיבוי וייצוא. */
const assert = require("assert");
const Q = require("../src/qualix.js");
const C = require("../src/recordings-core.js");

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const t = iso => Q.isoToPhoneTime(iso);
const ready = (recs, aliases) => { recs.forEach(r => C.prep(r, aliases || {})); return recs; };

test("שם קובץ: קיוליקס, אנדרואיד, תאריך מקוצר, ובלי תאריך", () => {
  const a = C.parseFileName("סבתא עזרא-נייד_20261019141433.wav");
  assert.deepEqual([a.name, a.number, a.iso, a.stamped], ["סבתא עזרא-נייד", "", "2026-10-19T14:14:33", true]);
  const b = C.parseFileName("053316887904550_20261019210930.wav"); assert.deepEqual([b.name, b.number], ["", "053316887904550"]);
  const c = C.parseFileName("Call recording אבא (+972 50-123-4567)_2026-10-30 09-43-32.m4a");
  assert.deepEqual([c.name, c.number, c.iso], ["אבא", "+972501234567", "2026-10-30T09:43:32"]);
  const d = C.parseFileName("הקלטת שיחה 0501234567 261030_094332.amr"); assert.deepEqual([d.number, d.iso], ["0501234567", "2026-10-30T09:43:32"]);
  const e = C.parseFileName("REC_0007.mp3", new Date(2026, 9, 1, 8, 5, 0).getTime());
  assert.deepEqual([e.name, e.number, e.stamped, e.iso], ["", "", false, "2026-10-01T08:05:00"], "מספור של הטלפון — לא מספר טלפון; הזמן מהקובץ");
  assert.equal(C.parseFileName("שיר.txt"), null); assert.equal(C.parseFileName("x_20261399120000.wav").stamped, false, "חודש 99 — לא תאריך");
});

test("מזהה קבוע: אותה הקלטה גם אחרי המרה (גודל אחר), ובלי תאריך — לפי שם וגודל", () => {
  const p = C.parseFileName("אבא_20261030082922.wav");
  assert.equal(C.recordId(p, 1000), C.recordId(p, 4000)); assert.equal(C.recordId(p, 1000), "2026-10-30T08:29:22|אבא");
  const q = C.parseFileName("שיחה.mp3", 0); assert.notEqual(C.recordId(q, 1), C.recordId(q, 2));
});

test("מספרים: בלי שלוחה, ותצוגה", () => {
  assert.equal(C.baseNumber("0331317741"), "033131774"); assert.equal(C.baseNumber("053316887904550"), "0533168879"); assert.equal(C.baseNumber("+972-50-123-4567"), "0501234567");
  assert.equal(C.formatPhone("0527109590"), "052-710-9590"); assert.equal(C.formatPhone("0331317741"), "03-313-1774 שלוחה 1"); assert.equal(C.formatPhone("1700111112"), "1700-111-112");
});

test("מיזוג סריקות: כרטיס, ריקים, העברה למחשב, ומחיקה מהכרטיס", () => {
  const byId = new Map();
  const card = [{ name: "אבא_20261030082922.wav", rel: "Audio/אבא_20261030082922.wav", size: 1000, duration: 2 }, { name: "0501_20261030082921.wav", rel: "Audio/0501_20261030082921.wav", size: 0 }, { name: "x.txt", rel: "Audio/x.txt", size: 5 }];
  let res = C.mergeScan(byId, "card", card);
  assert.equal(res.added.length, 1); assert.equal(res.empty.length, 1, "הקובץ הריק לא נכנס לארכיון, אבל חוזר לניקוי"); assert.equal(byId.size, 1);
  const r = res.added[0]; assert.deepEqual(r.loc, [{ folder: "card", rel: "Audio/אבא_20261030082922.wav", size: 1000 }]); assert.equal(r.duration, 2);
  res = C.mergeScan(byId, "card", card); assert.deepEqual([res.added.length, res.changed.length], [0, 0], "סריקה חוזרת לא משנה כלום");
  // הועבר למחשב (WAV רגיל — גודל אחר) ונמחק מהכרטיס
  res = C.mergeScan(byId, "f1", [{ name: "אבא_20261030082922.wav", rel: "2026-10/אבא_20261030082922.wav", size: 4000 }]);
  assert.deepEqual([res.added.length, res.changed.length, r.loc.length], [0, 1, 2], "אותה רשומה מקבלת מקום נוסף");
  res = C.mergeScan(byId, "card", []); assert.deepEqual(r.loc.map(l => l.folder), ["f1"], "נעלם מהכרטיס — נשאר רק המחשב");
  res = C.mergeScan(byId, "f1", []); assert.deepEqual([r.loc.length, byId.size], [0, 1], "בלי קובץ בכלל — הרשומה נשארת (תמלול וסיכום לא הולכים לאיבוד)");
});

test("השלמה מאנשי קשר ויומן — ומה שנלמד לא נשכח כשהיומן מתחלף", () => {
  const byId = new Map(); C.mergeScan(byId, "card", [{ name: "אבא_20261030082922.wav", rel: "a", size: 9 }, { name: "0331317741_20261030084830.wav", rel: "b", size: 9 }]);
  const recs = [...byId.values()], contacts = [{ name: "אבא", mobile: "0501234567" }, { name: "המשרד", home: "03-3131774" }];
  const calls = [{ number: "0501234567", type: "incoming", time: t("2026-10-30T08:29:22"), duration: 40 }, { number: "0331317741", type: "outgoing", time: t("2026-10-30T08:48:28"), duration: 90 }];
  assert.equal(C.enrich(recs, { contacts, calls }).length, 2);
  const [a, b] = recs; assert.deepEqual([a.number, a.type, a.contactName], ["0501234567", "incoming", "אבא"]); assert.deepEqual([b.contactName, b.type], ["המשרד", "outgoing"]);
  assert.equal(C.enrich(recs, { contacts: [], calls: [] }).length, 0, "יומן ריק לא מוחק כיוון שכבר נלמד");
  assert.equal(b.type, "outgoing");
});

test("שם לתצוגה, כינוי וסינון", () => {
  const byId = new Map(); C.mergeScan(byId, "card", [
    { name: "אבא_20261030082922.wav", rel: "1", size: 9, duration: 40 }, { name: "0527109590_20261030092043.wav", rel: "2", size: 9, duration: 237 },
    { name: "0527109590_20261001120000.wav", rel: "3", size: 9, duration: 3 }, { name: "קל קו_20260915201500.wav", rel: "4", size: 9, duration: 900 }]);
  const recs = ready([...byId.values()]); const [abba, tel, telOld, kal] = recs;
  abba.type = "incoming"; kal.type = "outgoing"; kal.star = true; kal.note = "לחזור אליו"; kal.tr = { segs: [{ s: 0, sp: "דובר 1", t: "מדברים על המשכנתא" }] };
  assert.equal(tel._.who, "052-710-9590"); assert.equal(tel._.saved, false);
  const aliases = { [C.contactKey(tel)]: "שמואל" }; ready(recs, aliases); assert.equal(tel._.who, "שמואל"); assert.equal(tel._.saved, true);
  const now = new Date(2026, 9, 30, 12).getTime(), F = o => C.filterRecs(recs, Object.assign(C.defaultFilter(), o), { now }).map(r => r.fileName);
  assert.deepEqual(F({}), [tel.fileName, abba.fileName, telOld.fileName, kal.fileName], "מהחדש לישן");
  assert.deepEqual(F({ date: "today" }).length, 2); assert.deepEqual(F({ date: "7d" }).length, 2); assert.deepEqual(F({ date: "custom", from: "2026-09-01", to: "2026-09-30" }), [kal.fileName]);
  assert.deepEqual(F({ contacts: ["שמואל"] }), [tel.fileName, telOld.fileName]);
  assert.deepEqual(F({ dir: "incoming" }), [abba.fileName]); assert.deepEqual(F({ dir: "unknown" }).length, 2);
  assert.deepEqual(F({ dur: "gt300" }), [kal.fileName]); assert.deepEqual(F({ status: "star" }), [kal.fileName]); assert.deepEqual(F({ status: "tr" }), [kal.fileName]);
  assert.deepEqual(F({ q: "משכנתא" }), [kal.fileName], "חיפוש בתוך התמלול"); assert.deepEqual(F({ q: "052-710" }), [tel.fileName, telOld.fileName], "חיפוש מספר עם מקף");
  assert.deepEqual(F({ tod: "evening" }), [kal.fileName]); assert.deepEqual(F({ wd: [2] }), [kal.fileName], "15.9.2026 = יום שלישי");
  assert.deepEqual(F({ sort: "long" })[0], kal.fileName); assert.deepEqual(F({ ids: new Set([abba.id]) }), [abba.fileName]);
  assert.equal(C.filterRecs(recs, C.defaultFilter(), { hideShort: 5, now }).length, 3, "הסתרת קצרות");
  assert.equal(C.hiddenCount(Object.assign(C.defaultFilter(), { dir: "incoming", wd: [1] })), 1, "הכיוון גלוי בלשוניות — לא נספר בנסתרים"); assert.equal(C.isFiltered(C.defaultFilter()), false);
});

test("סיכומים: לפי יום, אדם, חודש ושעה", () => {
  const byId = new Map(); C.mergeScan(byId, "card", [{ name: "אבא_20261030082922.wav", rel: "1", size: 9, duration: 40 }, { name: "אבא_20261030090000.wav", rel: "2", size: 9, duration: 20 }, { name: "אמא_20260915201500.wav", rel: "3", size: 9, duration: 900 }]);
  const recs = ready([...byId.values()]); recs[2].sum = { title: "x" };
  const days = C.byDay(recs); assert.deepEqual([days.get("2026-10-30").n, days.get("2026-10-30").s], [2, 60]);
  const months = C.monthsOf(recs), ppl = C.people(recs, months).sort((a, b) => b.s - a.s);
  assert.deepEqual(months, ["2026-09", "2026-10"]); assert.deepEqual([ppl[0].who, ppl[0].mon], ["אמא", [900, 0]]); assert.deepEqual([ppl[1].who, ppl[1].n, ppl[1].s], ["אבא", 2, 60]);
  const s = C.stats(recs); assert.deepEqual([s.n, s.contacts, s.total, s.ai, s.best.day, s.longest.fileName], [3, 2, 960, 1, "2026-09-15", "אמא_20260915201500.wav"]);
  assert.equal(s.hours[8].n, 1); assert.equal(s.hours[20].v, 900); assert.equal(s.buckets.find(b => b.label === "10–60 שנ׳").v, 2);
  assert.equal(C.heat(0), 0); assert.equal(C.heat(700), 2); assert.equal(C.heat(8000), 5);
  assert.equal(C.fmtDur(3478), "57:58"); assert.equal(C.fmtDur(3725), "1:02:05"); assert.equal(C.fmtTotal(45), "45 שנ׳"); assert.equal(C.fmtDay("2026-10-30", true), "יום שישי, 30 באוקטובר 2026");
});

test("תשובות AI: תמלול מכל ספק, סיכום, וחיפוש חכם", () => {
  assert.deepEqual(C.segsFromGemini('```json\n{"segments":[{"start":"01:05","speaker":"דובר 1","text":"שלום"}]}\n```'), [{ s: 65, sp: "דובר 1", t: "שלום" }]);
  assert.deepEqual(C.segsFromGemini("[00:03] דובר 2: מה נשמע\nסתם שורה"), [{ s: 3, sp: "דובר 2", t: "מה נשמע" }, { s: null, sp: "", t: "סתם שורה" }], "לא JSON — שורות טקסט");
  const el = C.segsFromElevenLabs({ words: [{ text: "שלום", start: 0, end: 0.5, type: "word", speaker_id: "speaker_0" }, { text: " ", type: "spacing" }, { text: "לך", start: 0.6, end: 0.9, type: "word", speaker_id: "speaker_0" }, { text: "תודה", start: 1, end: 1.4, type: "word", speaker_id: "speaker_1" }] });
  assert.deepEqual(el, [{ s: 0, sp: "דובר 1", t: "שלום לך" }, { s: 1, sp: "דובר 2", t: "תודה" }]);
  assert.deepEqual(C.segsFromOpenAI({ segments: [{ start: 2, speaker: "A", text: " היי " }] }, true), [{ s: 2, sp: "דובר 1", t: "היי" }]);
  assert.equal(C.segsFromOpenAI({ text: "משפט ראשון. משפט שני." }, false).length, 1, "משפטים קצרים מתאחדים");
  const sum = C.normalizeSummary({ title: "תשלום", summary: "דיברו", points: ["א", { text: "ב" }], tags: ["#כסף"], sentiment: "ניטרלית" }, { provider: "gemini" });
  assert.deepEqual([sum.points, sum.tags, sum.provider, sum.actions], [["א", "ב"], ["כסף"], "gemini", []]);
  const contacts = [{ who: "אבא", n: 3 }, { who: "שמואל כהן", n: 1 }];
  const { f, explain } = C.filterFromAI({ contacts: ["שמואל"], from: "2026-10-01", to: null, minSec: 300, hourFrom: 18, hourTo: 22, weekdays: [5], status: "sum", direction: "outgoing", text: "חתונה", sort: "long", explain: "ארוכות" }, contacts);
  assert.deepEqual([f.contacts, f.date, f.from, f.dur, f.tod, f.wd, f.status, f.dir, f.q, f.sort, explain], [["שמואל כהן"], "custom", "2026-10-01", "gt300", "evening", [5], "sum", "outgoing", "חתונה", "long", "ארוכות"]);
  assert.throws(() => C.parseJSONLoose("לא json"), /בפורמט הצפוי/);
  assert.ok(C.filterRequest("שיחות עם אבא", contacts, new Date(2026, 9, 30).getTime()).user.includes("אבא (3)"));
  assert.equal(C.mdLite("**חשוב**\n- א\n<script>"), "<p><b>חשוב</b></p><ul><li>א</li></ul><p>&lt;script&gt;</p>", "Markdown קל, בלי הזרקת HTML");
});

test("בקשת סיכום, ושאלה על כמה שיחות", () => {
  const byId = new Map(); C.mergeScan(byId, "card", [{ name: "אבא_20261030082922.wav", rel: "1", size: 9, duration: 40 }, { name: "אמא_20260915201500.wav", rel: "2", size: 9, duration: 90 }]);
  const recs = ready([...byId.values()]); recs[0].type = "incoming"; recs[0].tr = { segs: [{ s: 0, sp: "דובר 1", t: "נפגשים ביום חמישי" }] }; recs[0].note = "חשוב";
  const q = C.summaryRequest(recs[0]); assert.ok(q.user.includes("איש קשר: אבא") && q.user.includes("כיוון: נכנסת") && q.user.includes("[0:00] דובר 1: נפגשים ביום חמישי"));
  const c = C.corpus(recs); assert.deepEqual([c.used, c.withAI, c.total], [1, 1, 2]); assert.ok(c.text.includes("הערה של המשתמש: חשוב"));
  assert.ok(C.askRequest(c, "מתי נפגשים?").user.endsWith("השאלה של המשתמש: מתי נפגשים?"));
});

test("חלוקה לתמלול בנקודה שקטה, וגלי קול", () => {
  const sr = 100, pcm = new Int16Array(sr * 100).fill(1000); pcm.fill(0, 45 * sr, 47 * sr); // שקט בין 45 ל-47 שניות
  const parts = C.splitPoints(pcm, sr, 50); assert.equal(parts.length, 2); assert.ok(parts[0][1] > 45 * sr && parts[0][1] < 47 * sr, "החיתוך בתוך השקט"); assert.equal(parts[1][1], pcm.length);
  assert.deepEqual(C.splitPoints(new Int16Array(10), sr, 50), [[0, 10]]);
  const pk = C.peaksOf(Int16Array.from([0, 100, -400, 0]), 2); assert.equal(pk[1], 1); assert.ok(pk[0] > 0 && pk[0] < 1);
});

test("גיבוי: בלי מקומות הקבצים, ומיזוג בלי לדרוס", () => {
  const byId = new Map(); C.mergeScan(byId, "card", [{ name: "אבא_20261030082922.wav", rel: "1", size: 9 }]);
  const recs = ready([...byId.values()]); recs[0].note = "חשוב"; recs[0].tags = ["כסף"];
  const data = JSON.parse(JSON.stringify(C.backupData(recs, { "tel:050": "x" }, { hideShort: 3 })));
  assert.equal(data.recs[0].loc.length, 0); assert.equal(data.recs[0]._, undefined); assert.equal(data.app, "ankal-recordings");
  const other = new Map(); C.mergeScan(other, "card", [{ name: "אבא_20261030082922.wav", rel: "1", size: 9 }]); [...other.values()][0].note = "שלי"; [...other.values()][0].tags = ["בית"];
  const res = C.mergeBackup(other, data); const r = [...other.values()][0];
  assert.deepEqual([res.added.length, res.merged.length, r.note, r.tags, r.loc.length], [0, 1, "שלי", ["בית", "כסף"], 1], "הערה קיימת לא נדרסת; תגיות מתאחדות; המקום בכרטיס נשאר");
  assert.throws(() => C.mergeBackup(other, { app: "x" }), /לא קובץ גיבוי/);
});

test("שמות למספרים מרשימה, וייצוא לאקסל", () => {
  const byId = new Map(); C.mergeScan(byId, "card", [{ name: "0527109590_20261030092043.wav", rel: "1", size: 9, duration: 61 }, { name: "05271095901_20261030100000.wav", rel: "2", size: 9 }, { name: "אבא_20261030082922.wav", rel: "3", size: 9 }]);
  const recs = ready([...byId.values()]);
  const res = C.namesFromContacts(recs, [{ name: "שמואל", mobile: "052-710-9590" }], {});
  assert.deepEqual([res.named, res.calls], [1, 2], "גם המספר עם השלוחה"); assert.equal(C.namesFromContacts(recs, [{ name: "אחר", mobile: "0527109590" }], res.aliases).named, 0, "כינוי קיים לא נדרס");
  ready(recs, res.aliases); const rows = C.exportRows(recs);
  assert.equal(rows[0][3], "איש קשר"); const row = rows.find(x => x[14] === "0527109590_20261030092043.wav"); assert.deepEqual([row[0], row[3], row[6], row[7]], ["30.10.2026", "שמואל", 61, "1:01"]);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log("  ✓", name); } catch (error) { failed++; console.log("  ✗", name, "\n      " + String(error.stack || error.message).split("\n").slice(0, 3).join("\n      ")); } }
  if (failed) { console.log(`\n${failed} בדיקות הקלטות נכשלו.`); process.exit(1); }
  console.log(`\n${tests.length} בדיקות הקלטות עברו בהצלחה.`);
})();
