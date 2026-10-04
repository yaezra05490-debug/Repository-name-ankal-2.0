/* קיוליקס — קריאה וכתיבה של גיבוי "גיבוי ושחזור" (תיקיית ibphone בכרטיס הזיכרון).
   הפורמט פוענח מתוך גיבויים אמיתיים (אוקטובר 2026) ואומת מול ייצוא VCF של אותו טלפון.
   אין כאן תלות ב-DOM: הקובץ רץ גם בדפדפן וגם ב-Node (לבדיקות). */
(function (root) {
  "use strict";

  /* ---------- עזרי בתים ---------- */
  function u16le(str) { const out = new Uint8Array(str.length * 2); for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out[i * 2] = c & 255; out[i * 2 + 1] = c >> 8; } return out; }
  function readU16(bytes, off, chars) { let s = ""; for (let i = 0; i < chars; i++) { const c = bytes[off + i * 2] | (bytes[off + i * 2 + 1] << 8); s += String.fromCharCode(c); } return s; }
  function readU16z(bytes, off, maxChars) { let s = ""; for (let i = 0; i < maxChars && off + i * 2 + 1 < bytes.length; i++) { const c = bytes[off + i * 2] | (bytes[off + i * 2 + 1] << 8); if (!c) break; s += String.fromCharCode(c); } return s; }
  function putU16(bytes, off, str) { for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); bytes[off + i * 2] = c & 255; bytes[off + i * 2 + 1] = c >> 8; } }
  function dv(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  function concat(parts) { const total = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
  function same(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function ascii(str) { return Uint8Array.from(str, ch => ch.charCodeAt(0) & 255); }
  function utf8Encode(text) { return new TextEncoder().encode(text); }
  function utf8Decode(bytes) { return new TextDecoder("utf-8").decode(bytes); }

  /* CRC-16/ARC (poly 0x8005 reflected = 0xA001, init 0, no xorout) — זה מה שהטלפון שומר בכותרת לכל קובץ. */
  function crc16arc(bytes) { let crc = 0; for (let i = 0; i < bytes.length; i++) { crc ^= bytes[i]; for (let k = 0; k < 8; k++) crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1; } return crc & 0xFFFF; }

  /* ---------- מספרי טלפון ב-BCD (ניבל נמוך קודם, a=* b=# f=סיום) ---------- */
  const BCD = "0123456789*#pwe";
  function decodeBcd(bytes) { let s = ""; for (const b of bytes) { const lo = b & 15, hi = b >> 4; if (lo === 15) break; s += BCD[lo]; if (hi === 15) break; s += BCD[hi]; } return s; }
  function encodeBcd(text) {
    const digits = []; for (const ch of String(text || "")) { const k = BCD.indexOf(ch.toLowerCase()); if (k >= 0) digits.push(k); }
    const out = new Uint8Array(Math.ceil(digits.length / 2));
    for (let i = 0; i < digits.length; i += 2) out[i / 2] = digits[i] | ((i + 1 < digits.length ? digits[i + 1] : 15) << 4);
    return out;
  }
  // "+972..." נשמר כספרות בלבד עם סוג 0x11; כל השאר כסוג 0x01.
  function numberToSlot(text) { const clean = String(text || "").replace(/[\s\-().]/g, ""); const intl = clean.startsWith("+"); return { intl, bcd: encodeBcd(intl ? clean.slice(1) : clean) }; }
  function slotToNumber(bytes, off) { const len = bytes[off], type = bytes[off + 1]; if (!len) return ""; const digits = decodeBcd(bytes.subarray(off + 2, off + 2 + Math.min(len, 20))); return (type === 0x11 ? "+" : "") + digits; }

  /* ---------- מכולת .ib: כותרת 0x244 בתים ואז רשומות [size][1][ff×8] רשומה [ff×8] ---------- */
  const TYPES = { schedule: 0, callog: 1, phonebook: 2, settings: 3, memo: 4, udb: 5, playlist: 6 };
  const HEADER = 0x244;
  const FF8 = new Uint8Array(8).fill(0xFF);
  function parseIb(bytes) {
    if (!bytes || bytes.length < HEADER + 16) throw new Error("IB_TOO_SHORT");
    const name = readU16z(bytes, 0, 16), view = dv(bytes);
    const out = { name, type: view.getUint32(0x20, true), dataSize: view.getUint32(0x28, true), count: view.getUint32(0x2C, true), count2: view.getUint32(0x30, true), records: [] };
    // כל רשומה: [u32 גודל][u32 מספר הפריטים ברשומה][ff×8] תוכן [ff×8]. בספר הטלפונים וביומן כל רשומה היא פריט אחד;
    // ביומן השיחות ובמניפסטים יש רשומה אחת שמכילה את כל הפריטים, והשדה השני שווה למספרם.
    let pos = HEADER;
    while (pos + 16 <= bytes.length) {
      const size = view.getUint32(pos, true), items = view.getUint32(pos + 4, true);
      if (!size || !items || !same(bytes.subarray(pos + 8, pos + 16), FF8) || pos + 16 + size > bytes.length) break;
      out.records.push(bytes.slice(pos + 16, pos + 16 + size));
      pos += 16 + size + 8;
    }
    if (out.records.length !== out.count2) throw new Error("IB_RECORD_COUNT_MISMATCH:" + name);
    return out;
  }
  function buildIb({ name, type, records, count }) {
    const dataSize = records.reduce((n, r) => n + r.length, 0), total = count == null ? records.length : count;
    const head = new Uint8Array(HEADER); putU16(head, 0, name); const view = dv(head);
    view.setUint32(0x20, type, true); view.setUint32(0x24, 1, true); view.setUint32(0x28, dataSize, true); view.setUint32(0x2C, total, true); view.setUint32(0x30, records.length, true);
    const parts = [head], perRecord = records.length === 1 ? total : 1;
    for (const rec of records) { const frame = new Uint8Array(16); dv(frame).setUint32(0, rec.length, true); dv(frame).setUint32(4, perRecord, true); frame.set(FF8, 8); parts.push(frame, rec, FF8); }
    return concat(parts);
  }

  /* ---------- ספר טלפונים ---------- */
  const SLOTS = [0x10, 0x26, 0x3C, 0x52], SLOT_FIELDS = ["mobile", "home", "work", "fax"];
  const NAME_MAX = 80, EMAIL_MAX = 40, NOTE_MAX = 163, GROUP_MAX = 250;
  function lenStr(bytes, off, max) { const len = bytes[off] | (bytes[off + 1] << 8); return readU16(bytes, off + 2, Math.min(len, max)); }
  /* +0x04: ביט הקבוצה (קבוצה אחת = ביט אחד, עד 8 קבוצות; "משפחה" הייתה 0x08, קבוצה שנוצרה אחר כך קיבלה 0x80).
     +0x08: צלצול אישי — 0 = ברירת מחדל, 0x80 = קובץ מהכרטיס (הנתיב ב-PB\<0x2010000+id>_Ring.ini), ערך אחר = צלצול מובנה.
     +0x2AA: קבוע 6 כשיש קבוצה, ואחריו שם הקבוצה (רק ברשומות 1200). */
  function parsePhonebookRecord(rec) {
    const c = { id: rec[0] | (rec[1] << 8), name: lenStr(rec, 0x68, NAME_MAX), email: lenStr(rec, 0x10C, EMAIL_MAX), note: lenStr(rec, 0x160, NOTE_MAX), group: "", groupBit: rec[4], ringtone: rec[8] | (rec[9] << 8), ringtonePath: "" };
    SLOT_FIELDS.forEach((field, k) => { c[field] = slotToNumber(rec, SLOTS[k]); });
    c._slotTypes = SLOTS.map(off => rec[off + 1]);
    if (rec.length > 0x2AC) c.group = readU16z(rec, 0x2AC, GROUP_MAX);
    else if (rec[4] & 0x08) c.group = "משפחה"; // הפורמט הישן (684) שמר רק את הביט; הקבוצה היחידה שנראתה בו היא משפחה
    c._raw = rec;
    return c;
  }
  function parsePhonebook(bytes) {
    const ib = parseIb(bytes); if (ib.type !== TYPES.phonebook) throw new Error("NOT_PHONEBOOK");
    const recordSize = ib.records.length ? ib.records[0].length : 1200;
    return { recordSize, contacts: ib.records.map(parsePhonebookRecord) };
  }
  // סדר השמות בקובץ: רווחים, סימנים, ספרות, לטינית (בלי הבדל רישיות), עברית, אחר. בתוך מחלקה לפי קוד התו.
  function charClass(c) { if (c === 32) return 0; if (c >= 0x30 && c <= 0x39) return 2; if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) return 3; if (c >= 0x5D0 && c <= 0x5EA) return 4; if (c < 0x80) return 1; return 5; }
  function nameSortKey(name) { let key = ""; for (const ch of String(name || "")) { const c = ch.charCodeAt(0); key += String.fromCharCode(0x30 + charClass(c)) + ch.toLowerCase(); } return key; }
  function compareNames(a, b) { const ka = nameSortKey(a), kb = nameSortKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; }
  function buildPhonebookRecord(c, recordSize, groupBit) {
    const rec = new Uint8Array(recordSize);
    rec[0] = c.id & 255; rec[1] = c.id >> 8; rec[2] = 1; rec[3] = 2; rec[4] = c.group ? (groupBit & 255) : 0; rec[8] = (c.ringtone || 0) & 255; rec[9] = ((c.ringtone || 0) >> 8) & 255; rec[0x0B] = 1;
    SLOT_FIELDS.forEach((field, k) => {
      const { intl, bcd } = numberToSlot(c[field]); if (!bcd.length) return;
      const kept = c._slotTypes && c._slotTypes[k]; // הטלפון כותב 0x01 כמעט תמיד, לפעמים 0x00; שומרים את מה שהיה כשהמספר לא השתנה
      const off = SLOTS[k]; rec[off] = Math.min(bcd.length, 20); rec[off + 1] = intl ? 0x11 : (kept != null && kept !== 0x11 ? kept : 0x01); rec.set(bcd.subarray(0, 20), off + 2); rec[0x0C + k] = k + 1;
    });
    const put = (off, text, max) => { const s = String(text || "").slice(0, max); rec[off] = s.length & 255; rec[off + 1] = s.length >> 8; putU16(rec, off + 2, s); };
    put(0x68, c.name, NAME_MAX); put(0x10C, c.email, EMAIL_MAX); put(0x160, String(c.note || "").replace(/\r\n/g, "\n"), NOTE_MAX);
    if (recordSize > 0x2AC && c.group) { rec[0x2AA] = 6; putU16(rec, 0x2AC, String(c.group).slice(0, GROUP_MAX)); }
    return rec;
  }
  /* מפת קבוצות: שם → ביט. קודם מה שכבר כתוב ברשומות, ואז ביט פנוי לכל קבוצה חדשה (עד 8). */
  function groupBits(contacts, preset) {
    const bits = Object.assign({}, preset || {});
    for (const c of contacts) if (c.group && c.groupBit && !bits[c.group]) bits[c.group] = c.groupBit;
    const taken = new Set(Object.values(bits));
    for (const c of contacts) { if (!c.group || bits[c.group]) continue; let bit = 1; while (taken.has(bit) && bit < 256) bit <<= 1; if (bit > 128) throw new Error("TOO_MANY_GROUPS"); bits[c.group] = bit; taken.add(bit); }
    return bits;
  }
  /* בונה phonebook.ib: רשומות ממוינות כמו שהטלפון כותב, מזהה חריץ לכל איש קשר, וביט לכל קבוצה.
     איש קשר שלא השתנה (יש לו _raw ואין _dirty) נכתב בית-בבית כפי שנקרא. */
  function buildPhonebook(contacts, options = {}) {
    const recordSize = options.recordSize || 1200;
    const used = new Set();
    for (const c of contacts) { if (c.id > 0 && !used.has(c.id)) used.add(c.id); else c.id = 0; }
    let next = 1; const freeId = () => { while (used.has(next)) next++; used.add(next); return next; };
    const bits = groupBits(contacts, options.groupBits);
    const sorted = contacts.slice().sort((a, b) => compareNames(a.name, b.name));
    const records = sorted.map(c => {
      if (!c.id) c.id = freeId();
      if (c._raw && !c._dirty && c._raw.length === recordSize) return c._raw;
      return buildPhonebookRecord(c, recordSize, c.group ? bits[c.group] : 0);
    });
    return buildIb({ name: "phonebook.ib", type: TYPES.phonebook, records });
  }

  /* ---------- צלצול אישי: PB\<33619968+id>_Ring.ini בכרטיס (לא בתוך תיקיית הגיבוי) ----------
     u32 1, u32 אורך הנתיב בתווים, נתיב UTF-16 מרופד עד 520, u32 גודל קובץ ה-mp3, u32 6. */
  const RING_BASE = 0x2010000, RING_SIZE = 528;
  function ringFileName(id) { return `${RING_BASE + id}_Ring.ini`; }
  function ringIdFromFileName(name) { const m = /^(\d+)_Ring\.ini$/i.exec(name || ""); if (!m) return 0; const id = +m[1] - RING_BASE; return id > 0 && id < 65536 ? id : 0; }
  function parseRingIni(bytes) { if (!bytes || bytes.length < 16) return null; const view = dv(bytes), len = view.getUint32(4, true); return { path: readU16(bytes, 8, Math.min(len, 256)), fileSize: bytes.length >= RING_SIZE ? view.getUint32(520, true) : 0 }; }
  function buildRingIni(path, fileSize) { const out = new Uint8Array(RING_SIZE), view = dv(out); const p = String(path || "").slice(0, 255); view.setUint32(0, 1, true); view.setUint32(4, p.length, true); putU16(out, 8, p); view.setUint32(520, fileSize >>> 0, true); view.setUint32(524, 6, true); return out; }
  const RINGTONE_FILE = 0x80;

  /* ---------- זמן הטלפון: שניות מ-1980-01-01 00:00 לפי שעון הקיר (בלי אזורי זמן) ---------- */
  const EPOCH_1980 = Date.UTC(1980, 0, 1);
  function phoneTimeToParts(seconds) { const d = new Date(EPOCH_1980 + seconds * 1000); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() }; }
  function partsToPhoneTime(p) { return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0, p.second || 0) - EPOCH_1980) / 1000); }
  const pad2 = n => String(n).padStart(2, "0");
  function phoneTimeToIso(seconds) { const p = phoneTimeToParts(seconds); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`; }
  function isoToPhoneTime(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(iso || "")); if (!m) return 0; return partsToPhoneTime({ year: +m[1], month: +m[2], day: +m[3], hour: +(m[4] || 0), minute: +(m[5] || 0), second: +(m[6] || 0) }); }

  /* ---------- יומן שיחות: תת-כותרת 16 בתים ואז 100 כניסות × 136 ---------- */
  const CALL_TYPES = { 0: "missed", 1: "outgoing", 2: "incoming", 3: "rejected" };
  const CALL_TYPE_HE = { missed: "לא נענתה", outgoing: "יוצאת", incoming: "נכנסת", rejected: "נדחתה" };
  const CALLOG_SUBHEADER = Uint8Array.from([0x06, 0, 0, 0, 0x02, 0, 0, 0, 0, 0, 0, 0, 0x64, 0, 0x05, 0x20]);
  const CALLOG_ENTRIES = 100, CALLOG_ENTRY = 136, CALLS_PER_ENTRY = 10;
  function parseCallog(bytes) {
    const ib = parseIb(bytes); if (ib.type !== TYPES.callog || !ib.records.length) throw new Error("NOT_CALLOG");
    const rec = ib.records[0], view = dv(rec), entries = [];
    for (let i = 0; i < CALLOG_ENTRIES; i++) {
      const o = 16 + i * CALLOG_ENTRY; if (o + CALLOG_ENTRY > rec.length || !view.getUint32(o, true)) continue;
      const count = Math.min(rec[o + 0x7A] | (rec[o + 0x7B] << 8), CALLS_PER_ENTRY), calls = [];
      for (let k = 0; k < count; k++) calls.push({ time: view.getUint32(o + 0x24 + k * 4, true), duration: view.getUint32(o + 0x4C + k * 4, true) });
      // +0x05 סוג המספר (0x11 = בינלאומי), +0x06 אורך ה-BCD, +0x07 הספרות
      const len = rec[o + 6], number = (rec[o + 5] === 0x11 ? "+" : "") + (len ? decodeBcd(rec.subarray(o + 7, o + 7 + Math.min(len, 20))) : "");
      entries.push({ number, typeCode: view.getUint32(o + 0x7C, true), type: CALL_TYPES[view.getUint32(o + 0x7C, true)] || "missed", calls, extra: view.getUint32(o + 0x1C, true), _raw: rec.slice(o, o + CALLOG_ENTRY) });
    }
    return { entries, subHeader: rec.slice(0, 16) };
  }
  function buildCallogEntry(e) {
    const rec = new Uint8Array(CALLOG_ENTRY), view = dv(rec);
    view.setUint32(0, 1, true);
    const { intl, bcd } = numberToSlot(e.number); rec[5] = intl ? 0x11 : 1; rec[6] = Math.min(bcd.length, 20); rec.set(bcd.subarray(0, 20), 7);
    view.setUint32(0x1C, e.extra || 0, true); view.setUint32(0x20, 1, true);
    const calls = (e.calls || []).slice(-CALLS_PER_ENTRY); // הסדר כפי שהטלפון שמר (בדרך כלל מהישנה לחדשה); שיחה חדשה מתווספת בסוף
    calls.forEach((call, k) => { view.setUint32(0x24 + k * 4, call.time >>> 0, true); view.setUint32(0x4C + k * 4, (call.duration || 0) >>> 0, true); });
    rec[0x7A] = calls.length; view.setUint32(0x7C, typeof e.typeCode === "number" ? e.typeCode : (Object.keys(CALL_TYPES).find(k => CALL_TYPES[k] === e.type) | 0), true);
    return rec;
  }
  /* הטלפון מציג את הכניסות לפי השיחה האחרונה בכל אחת, מהחדשה לישנה; כניסה שלא השתנתה נכתבת כפי שנקראה. */
  function buildCallog(entries, options = {}) {
    const live = entries.filter(e => e.calls && e.calls.length).map(e => ({ e, latest: Math.max(...e.calls.map(c => c.time)) })).sort((a, b) => b.latest - a.latest).slice(0, CALLOG_ENTRIES);
    const rec = new Uint8Array(16 + CALLOG_ENTRIES * CALLOG_ENTRY); rec.set(options.subHeader || CALLOG_SUBHEADER, 0);
    live.forEach(({ e }, i) => rec.set(e._raw && !e._dirty ? e._raw : buildCallogEntry(e), 16 + i * CALLOG_ENTRY));
    return buildIb({ name: "callog.ib", type: TYPES.callog, records: [rec], count: CALLOG_ENTRIES });
  }

  /* ---------- יומן פגישות: רשומות 748 ---------- */
  const SCHEDULE_RECORD = 748, TITLE_MAX = 82, TAIL_NEW = 0xD8;
  const SCHEDULE_TAIL = Uint8Array.from([0x06, 0, 0x17, 0x40, 0, 0, 0, 0, 0x01, 0, 0, 0]);
  function parseScheduleRecord(rec) {
    const view = dv(rec), len = rec[0x30] | (rec[0x31] << 8);
    return { title: readU16(rec, 0x32, Math.min(len, TITLE_MAX)), date: `${view.getUint16(0x0E, true)}-${pad2(rec[0x10])}-${pad2(rec[0x11])}`, time: `${pad2(rec[0x12])}:${pad2(rec[0x13])}`,
      reminder: rec[1] === 1, reminderId: view.getUint32(4, true), kind: view.getUint32(0x24, true), style: view.getUint16(0x2A, true), _raw: rec };
  }
  function parseSchedule(bytes) { const ib = parseIb(bytes); if (ib.type !== TYPES.schedule) throw new Error("NOT_SCHEDULE"); return { events: ib.records.map(parseScheduleRecord) }; }
  function buildScheduleRecord(ev, template) {
    const rec = new Uint8Array(SCHEDULE_RECORD), view = dv(rec);
    rec[0] = 1; rec[1] = ev.reminder ? 1 : 0; view.setUint32(4, ev.reminder ? (ev.reminderId || 0) : (ev.reminderId || 0), true); view.setUint32(8, 4, true);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ev.date || ""), t = /^(\d{2}):(\d{2})/.exec(ev.time || "00:00");
    const year = m ? +m[1] : 2026, month = m ? +m[2] : 1, day = m ? +m[3] : 1;
    for (const off of [0x0E, 0x14, 0x18]) { view.setUint16(off, year, true); rec[off + 2] = month; rec[off + 3] = day; }
    rec[0x12] = t ? +t[1] : 0; rec[0x13] = t ? +t[2] : 0;
    view.setUint32(0x20, 63, true); view.setUint32(0x24, ev.kind == null ? (template ? template.kind : 2) : ev.kind, true); view.setUint16(0x28, 60, true); view.setUint16(0x2A, ev.style == null ? (template ? template.style : 1) : ev.style, true);
    const title = String(ev.title || "").slice(0, TITLE_MAX); rec[0x30] = title.length & 255; rec[0x31] = title.length >> 8; putU16(rec, 0x32, title);
    rec.set(SCHEDULE_TAIL, TAIL_NEW);
    return rec;
  }
  function buildSchedule(events) {
    const template = events.map(e => ({ kind: e.kind, style: e.style })).pop();
    const records = events.map(ev => (ev._raw && !ev._dirty) ? ev._raw : buildScheduleRecord(ev, template));
    return buildIb({ name: "schedule.ib", type: TYPES.schedule, records });
  }

  /* ---------- רשימת השמעה (.lst): כותרת ASCII 27 בתים ואז נתיבים UTF-16 ברוחב 528 ---------- */
  /* כל ערך: נתיב UTF-16 (עד 520 בתים), u32 לא מזוהה (נשמר כפי שנקרא, 0 לשיר חדש), u32 גודל קובץ השיר. */
  const LST_HEADER = "MUSICARRAY SAVEFILE 01.00.0", LST_ENTRY = 528;
  function parseLst(bytes) {
    if (bytes.length < 27 || utf8Decode(bytes.subarray(0, 27)) !== LST_HEADER) throw new Error("NOT_LST");
    const entries = [], view = dv(bytes);
    for (let o = 27; o + LST_ENTRY <= bytes.length; o += LST_ENTRY) { const p = readU16z(bytes, o, 260); if (p) entries.push({ path: p, meta: view.getUint32(o + 520, true), fileSize: view.getUint32(o + 524, true) }); }
    return entries;
  }
  function buildLst(entries) {
    const out = new Uint8Array(27 + entries.length * LST_ENTRY), view = dv(out); out.set(ascii(LST_HEADER), 0);
    entries.forEach((e, i) => { const item = typeof e === "string" ? { path: e } : e; const o = 27 + i * LST_ENTRY; putU16(out, o, String(item.path || "").slice(0, 259)); view.setUint32(o + 520, (item.meta || 0) >>> 0, true); view.setUint32(o + 524, (item.fileSize || 0) >>> 0, true); });
    return out;
  }

  /* ---------- מניפסטים (memo.ib / playlist.ib / udb.ib): אילו קבצים הועתקו לתיקיית הגיבוי ---------- */
  const MANIFEST_ENTRY = 1066;
  function parseManifest(bytes) {
    const ib = parseIb(bytes); if (!ib.records.length) throw new Error("EMPTY_MANIFEST");
    const rec = ib.records[0], view = dv(rec);
    const totalBytes = view.getUint16(6, true) | (view.getUint16(4, true) << 16);
    let end = rec.length; while (end > 12 && !rec[end - 1] && !rec[end - 2]) end -= 2;
    const text = readU16(rec, 12, Math.max(0, (end - 12) / 2));
    const entries = text.split("srcpathmark").filter(Boolean).map(part => { const [src, dst] = part.split("destpathmark"); return { src, dst: dst || "" }; });
    return { name: ib.name, type: ib.type, totalBytes, flagA: view.getUint16(8, true), flagB: view.getUint16(10, true), entries, count: ib.count };
  }
  function buildManifest({ name, type, entries, totalBytes, flagA = 0, flagB = null, count = null }) {
    const text = entries.map(e => "srcpathmark" + e.src + "destpathmark" + e.dst).join("");
    const rec = new Uint8Array(12 + 2 + MANIFEST_ENTRY * entries.length), view = dv(rec);
    view.setUint16(4, (totalBytes >>> 16) & 0xFFFF, true); view.setUint16(6, totalBytes & 0xFFFF, true); view.setUint16(8, flagA, true); view.setUint16(10, flagB == null ? entries.length : flagB, true);
    if (text.length * 2 > rec.length - 12) throw new Error("MANIFEST_TOO_LONG");
    putU16(rec, 12, text);
    return buildIb({ name, type, records: [rec], count: count == null ? entries.length : count });
  }

  /* ---------- ibphone_head.in: 324 בתים, מפת קטגוריות, סכום גדלים ו-CRC לכל קובץ ---------- */
  const CATEGORIES = ["schedule", "callog", "phonebook", "settings", "memo", "udb", "playlist"];
  function parseHead(bytes) {
    const view = dv(bytes), bits = view.getUint32(0xD4, true);
    return { folder: readU16z(bytes, 4, 24), path: readU16z(bytes, 0x34, 40), version: utf8Decode(bytes.subarray(0x84, 0x8E)), bits, categories: CATEGORIES.filter((_, k) => bits & (1 << (16 + k))), sum: view.getUint32(0xDC, true), crcs: CATEGORIES.map((_, k) => view.getUint32(0xF8 + k * 4, true)) };
  }
  /* files: מפה { schedule: bytes, callog: bytes, ... } של קובצי ה-.ib שנכללים בגיבוי. */
  function buildHead({ folder, cardLetter = "E", files }) {
    const out = new Uint8Array(324), view = dv(out);
    putU16(out, 4, String(folder).slice(0, 23)); putU16(out, 0x34, `${cardLetter}:\\ibphone\\${folder}`.slice(0, 39));
    out.set(ascii("0001.00003"), 0x84); out.set(ascii("mmikeyback"), 0xB6);
    let bits = 0, sum = 0;
    CATEGORIES.forEach((cat, k) => { const f = files[cat]; if (!f) return; bits |= 1 << (16 + k); sum += dv(f).getUint32(0x28, true); view.setUint32(0xF8 + k * 4, crc16arc(f), true); });
    view.setUint32(0xD4, bits, true); view.setUint32(0xDC, sum, true);
    return out;
  }
  function backupFolderName(date = new Date()) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`; }

  /* ---------- פתקים: UTF-8 עם BOM, מעברי שורה LF ---------- */
  const BOM = Uint8Array.from([0xEF, 0xBB, 0xBF]);
  // הטלפון מרפד את סוף הקובץ בבתי אפס; הם אינם חלק מהטקסט
  function parseMemo(bytes) { const b = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? bytes.subarray(3) : bytes; return utf8Decode(b).replace(/\0/g, "").replace(/\r\n?/g, "\n"); }
  function buildMemo(text) { return concat([BOM, utf8Encode(String(text || "").replace(/\r\n?/g, "\n"))]); }
  function memoFileName(date = new Date()) { let r = ""; while (r.length < 10) r += Math.floor(Math.random() * 10); return `MEMO_${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}${r}.txt`; }
  function memoDateFromName(name) { const m = /MEMO_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name || ""); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : ""; }

  /* ---------- רוחב טקסט על מסך הטלפון (פונט פרופורציונלי). רוחב שורה = 1000 יחידות.
     כויל מפתקים אמיתיים: 14 ש / 38 ו / 17 ~ / 32 ' לשורה; השאר הוערך לפי יחסי פונט ערבי-עברי רגילים. ---------- */
  // ערכים מכוילים (עיגול כלפי מטה, כדי ששורה שנכנסת בטלפון תיכנס גם כאן): 14 ש, 38 ו, 17 ~, 32 ', |+28 רווחים+| לשורה
  const WIDTHS = { " ": 30, "ו": 26, "י": 26, "ז": 34, "ן": 26, "'": 31, "|": 26, "!": 28, ".": 28, ",": 28, ":": 28, ";": 28, "~": 58, "-": 36, "(": 36, ")": 36, '"': 38, "ש": 71, "ם": 62, "מ": 65, "ת": 62, "א": 61, "ב": 60, "ג": 46, "ד": 53, "ה": 61, "ח": 61, "ט": 61, "ך": 53, "כ": 53, "ל": 53, "נ": 44, "ס": 61, "ע": 61, "ף": 53, "פ": 61, "ץ": 55, "צ": 61, "ק": 61, "ר": 53 };
  const DEFAULT_WIDTH = 60, LINE_UNITS = 1000;
  function charWidth(ch, table) { const t = table || WIDTHS; if (t[ch] != null) return t[ch]; const c = ch.charCodeAt(0); if (c >= 0x30 && c <= 0x39) return 60; if (/[iljtfI1.,:;'!|]/.test(ch)) return 30; if (/[A-Z]/.test(ch)) return 72; if (/[a-z]/.test(ch)) return 58; return DEFAULT_WIDTH; }
  function textWidth(text, table) { let w = 0; for (const ch of String(text || "")) w += charWidth(ch, table); return w; }
  function centerLine(line, table) { const text = String(line || "").trim(); const free = LINE_UNITS - textWidth(text, table); if (free <= 0) return text; return " ".repeat(Math.floor(free / 2 / charWidth(" ", table))) + text; }
  function centerText(text, table) { return String(text || "").split("\n").map(l => centerLine(l, table)).join("\n"); }
  // כיול: פתק שבו כל שורה היא תו אחד שחוזר עד שהשורה מתמלאה → רוחב התו = 1000 / מספר החזרות
  // שורה של תו אחד שחוזר עד שהשורה מלאה: רוחב התו = 1000 / מספר החזרות, מעוגל כלפי מטה כדי שהשורה תיכנס
  function calibrateFromMemo(text, table) { const out = Object.assign({}, table || WIDTHS); for (const line of String(text || "").split("\n")) { const t = line.replace(/\s+$/, ""); if (t.length >= 3 && [...t].every(ch => ch === t[0])) out[t[0]] = Math.floor(LINE_UNITS / t.length); } return out; }

  /* ---------- מילון המשתמש (udb.cache): המבנה פוענח, קידוד האותיות עדיין לא. קריאה בלבד. ---------- */
  function parseUdb(bytes) {
    const words = [], refs = []; if (!bytes || bytes.length < 0x840) return { words, refs };
    const view = dv(bytes); let p = 0x838, guard = 0;
    while (p + 4 <= bytes.length && guard++ < 500) { const size = view.getUint16(p + 2, true); if (!size) break; if (size >= 8 && view.getUint16(p + 4, true) === 0x3FFE) { const len = view.getUint16(p + 6, true); words.push(readU16(bytes, p + 8, len)); } else if (size === 8) refs.push({ value: view.getUint16(p + 4, true), length: view.getUint16(p + 6, true) }); p += size; }
    return { words, refs };
  }

  /* עדכון מילים במילון (ניסיוני): הרשומות הקיימות נשמרות, מילים שהוסרו נמחקות מהשרשרת, מילים חדשות
     מתווספות בסוף כפי שהטלפון עצמו עושה (רשומת סימון ff 3f ואחריה המילה). שדה "בשימוש" (0x824) מתעדכן,
     ובערך הביקורת (0x818) החצי הנמוך הוא Adler-a על הנתונים — החצי הגבוה לא פוענח ונשאר כפי שהיה. */
  function updateUdbWords(bytes, { add = [], remove = [] } = {}) {
    const src = bytes && bytes.length >= 0x840 ? bytes : new Uint8Array(4096);
    const out = new Uint8Array(4096); out.set(src.subarray(0, Math.min(src.length, 4096)));
    const view = dv(src), items = []; let p = 0x838, guard = 0;
    while (p + 4 <= src.length && guard++ < 500) { const size = view.getUint16(p + 2, true); if (!size) break; items.push(src.slice(p, p + size)); p += size; }
    const isWord = it => it.length >= 8 && (it[4] | (it[5] << 8)) === 0x3FFE;
    const wordOf = it => readU16(it, 8, it[6] | (it[7] << 8));
    const isMarker = it => it.length === 8 && (it[4] | (it[5] << 8)) === 0x3FFF && !(it[6] | it[7]);
    const removeSet = new Set(remove);
    const kept = []; for (let i = 0; i < items.length; i++) { const it = items[i]; if (isWord(it) && removeSet.has(wordOf(it))) { if (kept.length && isMarker(kept[kept.length - 1])) kept.pop(); continue; } kept.push(it); }
    for (const w of add) { const word = String(w || "").trim().slice(0, 60); if (!word || kept.some(it => isWord(it) && wordOf(it) === word)) continue; const marker = Uint8Array.from([0, 0, 8, 0, 0xFF, 0x3F, 0, 0]); const entry = new Uint8Array(8 + word.length * 2); entry[2] = entry.length & 255; entry[3] = entry.length >> 8; entry[4] = 0xFE; entry[5] = 0x3F; entry[6] = word.length & 255; entry[7] = word.length >> 8; putU16(entry, 8, word); kept.push(marker, entry); }
    // שדה "הגודל הקודם" של כל רשומה = גודל הרשומה שלפניה
    out.fill(0, 0x838); let q = 0x838, prev = kept.length ? (items[0] ? (items[0][0] | (items[0][1] << 8)) : 0) : 0;
    for (const it of kept) { if (q + it.length > 4096 - 4) throw new Error("UDB_FULL"); out.set(it, q); out[q] = prev & 255; out[q + 1] = prev >> 8; prev = it.length; q += it.length; }
    const used = q - 0x838 + 4; dv(out).setUint32(0x824, used, true);
    let a = 1; for (let i = 0x834; i < 0x838 + used && i < 4096; i++) a = (a + out[i]) % 65521;
    dv(out).setUint16(0x818, a, true);
    return out;
  }

  /* ---------- הרכבת תיקיית גיבוי שלמה ----------
     source: תוצאת readBackup (או null). changes: { contacts, callog, events, memos:[{fileName,text,bytes?}], playlists:[{name,paths,bytes?}] }
     מחזיר רשימת קבצים { name, bytes } לכתיבה בתיקייה E:\ibphone\<folder>. */
  function assembleBackup({ folder, cardLetter = "E", contacts, recordSize, callog, events, memos, playlists, settings, udb }) {
    const files = [], ib = {};
    const dest = name => `${cardLetter}:\\ibphone\\${folder}\\${name}`;
    if (contacts) { ib.phonebook = buildPhonebook(contacts, { recordSize }); files.push({ name: "phonebook.ib", bytes: ib.phonebook }); }
    if (callog) { ib.callog = buildCallog(callog.entries, { subHeader: callog.subHeader }); files.push({ name: "callog.ib", bytes: ib.callog }); }
    if (events) { ib.schedule = buildSchedule(events); files.push({ name: "schedule.ib", bytes: ib.schedule }); }
    if (settings) { ib.settings = settings; files.push({ name: "settings.ib", bytes: settings }); }
    if (memos) {
      const entries = [], withBytes = memos.map(m => ({ fileName: m.fileName, bytes: m.bytes && !m._dirty ? m.bytes : buildMemo(m.text) }));
      for (const m of withBytes) { files.push({ name: m.fileName, bytes: m.bytes }); entries.push({ src: `${cardLetter}:\\Memo\\${m.fileName}`, dst: dest(m.fileName) }); }
      ib.memo = buildManifest({ name: "memo.ib", type: TYPES.memo, entries, totalBytes: withBytes.reduce((n, m) => n + m.bytes.length, 0) }); files.push({ name: "memo.ib", bytes: ib.memo });
    }
    if (playlists) {
      const entries = [], withBytes = playlists.map(p => ({ name: p.name, bytes: p.bytes && !p._dirty ? p.bytes : buildLst(p.entries || p.paths || []) }));
      for (const p of withBytes) { files.push({ name: p.name, bytes: p.bytes }); entries.push({ src: `${cardLetter}:\\System\\Mp3_res\\${p.name}`, dst: dest(p.name) }); }
      ib.playlist = buildManifest({ name: "playlist.ib", type: TYPES.playlist, entries, totalBytes: withBytes.reduce((n, p) => n + p.bytes.length, 0) }); files.push({ name: "playlist.ib", bytes: ib.playlist });
    }
    if (udb) {
      const phoneCache = udb.phoneCache || new Uint8Array(0), cardCache = udb.cardCache || new Uint8Array(0);
      files.push({ name: "udb.cache", bytes: phoneCache }, { name: "000000000000001", bytes: cardCache });
      ib.udb = buildManifest({ name: "udb.ib", type: TYPES.udb, entries: [{ src: "D:\\@cstardata\\udb.cache", dst: dest("udb.cache") }, { src: `${cardLetter}:\\@cstardata\\udb.cache`, dst: dest("000000000000001") }], totalBytes: phoneCache.length + cardCache.length, flagA: 1, flagB: 1 });
      files.push({ name: "udb.ib", bytes: ib.udb });
    }
    files.push({ name: "ibphone_head.in", bytes: buildHead({ folder, cardLetter, files: ib }) });
    return files;
  }

  /* ---------- קריאת תיקיית גיבוי: readFile(name) מחזיר Uint8Array או null; listFiles() מחזיר שמות ---------- */
  async function readBackup({ folder, listFiles, readFile }) {
    const names = await listFiles(); const has = n => names.includes(n);
    const out = { folder, categories: [], groups: [] };
    const headBytes = has("ibphone_head.in") ? await readFile("ibphone_head.in") : null; out.head = headBytes ? parseHead(headBytes) : null;
    if (has("phonebook.ib")) { const pb = parsePhonebook(await readFile("phonebook.ib")); out.contacts = pb.contacts; out.recordSize = pb.recordSize; out.categories.push("phonebook"); out.groups = [...new Set(pb.contacts.map(c => c.group).filter(Boolean))]; }
    if (has("callog.ib")) { out.callog = parseCallog(await readFile("callog.ib")); out.categories.push("callog"); }
    if (has("schedule.ib")) { out.events = parseSchedule(await readFile("schedule.ib")).events; out.categories.push("schedule"); }
    if (has("settings.ib")) { out.settings = await readFile("settings.ib"); out.categories.push("settings"); }
    if (has("memo.ib")) { const man = parseManifest(await readFile("memo.ib")); out.memos = []; for (const e of man.entries) { const fileName = e.dst.split("\\").pop(); const bytes = has(fileName) ? await readFile(fileName) : null; if (bytes) out.memos.push({ fileName, bytes, text: parseMemo(bytes), created: memoDateFromName(fileName) }); } out.categories.push("memo"); }
    if (has("playlist.ib")) { const man = parseManifest(await readFile("playlist.ib")); out.playlists = []; for (const e of man.entries) { const name = e.dst.split("\\").pop(); const bytes = has(name) ? await readFile(name) : null; if (bytes) { let entries = []; try { entries = parseLst(bytes); } catch (_) { } out.playlists.push({ name, bytes, entries }); } } out.categories.push("playlist"); }
    if (has("udb.ib")) { out.udb = { phoneCache: has("udb.cache") ? await readFile("udb.cache") : new Uint8Array(0), cardCache: has("000000000000001") ? await readFile("000000000000001") : new Uint8Array(0) }; out.dictionary = parseUdb(out.udb.cardCache.length ? out.udb.cardCache : out.udb.phoneCache); out.categories.push("udb"); }
    return out;
  }

  const api = { crc16arc, encodeBcd, decodeBcd, parseIb, buildIb, parsePhonebook, buildPhonebook, buildPhonebookRecord, groupBits, nameSortKey, compareNames, ringFileName, ringIdFromFileName, parseRingIni, buildRingIni, RINGTONE_FILE, parseCallog, buildCallog, parseSchedule, buildSchedule, parseLst, buildLst, parseManifest, buildManifest, parseHead, buildHead, backupFolderName, parseMemo, buildMemo, memoFileName, memoDateFromName, phoneTimeToIso, isoToPhoneTime, phoneTimeToParts, partsToPhoneTime, textWidth, centerLine, centerText, calibrateFromMemo, WIDTHS, LINE_UNITS, parseUdb, updateUdbWords, assembleBackup, readBackup, CATEGORIES, TYPES, CALL_TYPES, CALL_TYPE_HE, SLOT_FIELDS, u16le, same };
  root.ANKAL_QUALIX = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
