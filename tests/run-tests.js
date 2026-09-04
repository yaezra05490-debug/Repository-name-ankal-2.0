const assert = require("assert"), fs = require("fs"), path = require("path"), cp = require("child_process");
const { parseVcfDetailed, buildVcf, foldLine } = require("../src/vcard.js");
let passed = 0; function test(name, fn) { fn(); passed++; console.log("✓", name); }
test("קורא item1.TEL וסוג מצוטט", () => { const r=parseVcfDetailed('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:דוד כהן\r\nitem1.TEL;TYPE="CELL,VOICE":tel:+972501234567\r\nEND:VCARD\r\n'); assert.equal(r.contacts[0].phones[0].value,"+972501234567"); assert.ok(r.contacts[0].phones[0].type.includes("CELL")); });
test("בונה שם נכון מ-N", () => assert.equal(parseVcfDetailed("BEGIN:VCARD\nVERSION:3.0\nN:כהן;דוד;;;\nEND:VCARD").contacts[0].name,"דוד כהן"));
test("קורא Base64", () => { const e=Buffer.from("דוד כהן").toString("base64"); assert.equal(parseVcfDetailed(`BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=BASE64:${e}\nEND:VCARD`).contacts[0].name,"דוד כהן"); });
test("משחזר כרטיס אחרון", () => { const r=parseVcfDetailed("BEGIN:VCARD\nVERSION:3.0\nFN:דוד"); assert.equal(r.contacts.length,1); assert.ok(r.warnings.length); });
test("מקפל שורות VCF", () => { const line=foldLine("NOTE:"+"א".repeat(100)); assert.ok(line.includes("\r\n ")); line.split("\r\n").forEach(p=>assert.ok(Buffer.byteLength(p.replace(/^ /,""))<=75)); });
test("ייצוא וייבוא שבעה שדות", () => { const c={name:"דוד",mobile:"0501",home:"02",work:"03",fax:"04",email:"a@b.c",note:"הערה"},r=parseVcfDetailed(buildVcf([c])).contacts[0]; assert.equal(r.phones.length,4); assert.equal(r.emails[0].value,"a@b.c"); assert.equal(r.note,"הערה"); });
test("אין הבטחות פרטיות ישנות", () => { const h=fs.readFileSync(path.join(__dirname,"../src/index.html"),"utf8"); assert.ok(!/לא נשלח לשום מקום|נשמר רק במכשיר|איננו שומרים/.test(h)); });
test("SEO מכיל דומיין אמיתי", () => { const s=["index.html","robots.txt","sitemap.xml"].map(x=>fs.readFileSync(path.join(__dirname,"../src",x),"utf8")).join("\n"); assert.ok(!s.includes("YOUR-DOMAIN-HERE")); assert.ok(s.includes("https://aivr-anshak.netlify.app")); });
test("כתובת הסקריפט: משתנה סביבה גובר, וכתובת לא תקינה נחסמת", () => { const p=fs.readFileSync(path.join(__dirname,"../netlify/functions/ankal-api.mjs"),"utf8"); assert.ok(p.includes("process.env.APPS_SCRIPT_URL"),"הפונקציה חייבת לקרוא את APPS_SCRIPT_URL מהסביבה"); assert.ok(p.includes("SERVER_NOT_CONFIGURED"),"חסרה חסימת כתובת לא תקינה"); });
test("תחביר JavaScript תקין", () => ["src/app.js","src/vcard.js","src/dedupe.js","main.js","preload.js","netlify/functions/ankal-api.mjs"].forEach(f=>cp.execFileSync(process.execPath,["--check",path.join(__dirname,"..",f)])));
test("כל הסקריפטים נטענים ב-index.html", () => { const h=fs.readFileSync(path.join(__dirname,"../src/index.html"),"utf8"); ["config.js","vcard.js","dedupe.js","app.js"].forEach(s=>assert.ok(h.includes(`src="${s}"`),s)); });
// מנוע הכפולים נבדק בקובץ נפרד, בתהליך משלו, כדי ששקיפות הפלט תישמר.
test("מנוע הכפולים", () => cp.execFileSync(process.execPath,[path.join(__dirname,"dedupe.test.js")],{stdio:"pipe"}));
test("חיווט הממשק", () => cp.execFileSync(process.execPath,[path.join(__dirname,"wiring.test.js")],{stdio:"pipe"}));
console.log(`\n${passed} בדיקות עברו בהצלחה.`);
