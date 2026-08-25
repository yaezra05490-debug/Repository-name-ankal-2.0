/* אנק"ל — מנוע איתור הכפולים והסימונים.
   נטען גם בדפדפן (window.ANKAL_DEDUPE) וגם ב-Node (module.exports), כדי שהבדיקות
   האוטומטיות יריצו בדיוק את הקוד שהאתר מריץ. אין כאן שום גישה ל-DOM. */
(function (root) {
  "use strict";

  const PHONE_FIELDS = ["mobile", "home", "work", "fax"];
  const FIELDS = ["name", ...PHONE_FIELDS, "email", "note"];
  const LABELS = { name: "שם", mobile: "נייד", home: "בית", work: "עבודה", fax: "פקס", email: "מייל", note: "הערה" };

  /* ---------------- מספרי טלפון ---------------- */

  /* המפתח שכל שתי כתיבות של אותו מספר חייבות לחלוק. ה-0 המוביל, ‎+972 ו-00972
     כולם נחתכים, ולכן "050-1234567", "‎+972501234567" ותא אקסל שאכל את האפס
     המוביל ("501234567") מקבלים אותו מפתח. פחות מ-8 ספרות זו שלוחה או זבל
     ("-", "אין", "n/a") ומחזיר "" — ערך כזה אסור לו לקשר בין שני כרטיסים. */
  function normalizePhone(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    let digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("972")) digits = digits.slice(3);
    digits = digits.replace(/^0+/, "");
    if (digits.length < 8) return "";
    // 8 ספרות = קווי, 9 = נייד/072. ארוך מזה הוא מספר זר; משווים לפי 9 הספרות
    // האחרונות כדי ששתי כתיבות שונות של אותו קידומת מדינה עדיין ייפגשו.
    return digits.length > 9 ? "INT:" + digits.slice(-9) : "IL:" + digits;
  }

  function israeliDigits(value) {
    let digits = String(value == null ? "" : value).replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("972")) digits = digits.slice(3);
    return digits.replace(/^0+/, "");
  }

  /* לאיזה שדה המספר שייך לפי הקידומת שלו. מחזיר "" כשהמספר אינו ישראלי מזוהה,
     ואז המתקשר שומר על השיוך הקיים במקום לנחש. */
  function guessPhoneKind(value) {
    const digits = israeliDigits(value);
    if (/^5\d{8}$/.test(digits)) return "mobile";
    if (/^7[2367]\d{7}$/.test(digits)) return "home";
    if (/^[23489]\d{7}$/.test(digits)) return "home";
    return "";
  }

  /* ההצעה "הכי קרובה למציאות": מספר שהקידומת שלו מזהה אותו תופס את מקומו הטבעי
     לפני מספר עמום, שני מספרים לא יכולים לחלוק שדה, ומספר שאין לו קידומת מוכרת
     נשאר במשבצת שבה הוא כבר יושב היום. currentSlots אופציונלי ומקביל ל-numbers. */
  function suggestPhoneSlots(numbers, currentSlots) {
    const current = currentSlots || [];
    const kinds = numbers.map(guessPhoneKind);
    const taken = Object.create(null);
    const out = new Array(numbers.length).fill("");

    const claim = (index, preference) => {
      for (const slot of preference) {
        if (!taken[slot]) { taken[slot] = true; out[index] = slot; return; }
      }
    };
    const withCurrentFirst = (index, base) => {
      const slot = current[index];
      return slot && base.includes(slot) ? [slot, ...base.filter((s) => s !== slot)] : base;
    };

    // סבב 1: מספרים שהקידומת מזהה בוודאות. סבב 2: כל השאר, לתוך מה שנשאר פנוי.
    numbers.forEach((_, i) => { if (kinds[i] === "mobile") claim(i, ["mobile", "home", "work", "fax"]); });
    numbers.forEach((_, i) => { if (kinds[i] === "home") claim(i, withCurrentFirst(i, ["home", "work", "fax", "mobile"])); });
    numbers.forEach((_, i) => { if (!kinds[i]) claim(i, withCurrentFirst(i, ["mobile", "home", "work", "fax"])); });
    return out;
  }

  /* בין כמה כתיבות של אותו מספר בוחרים את הקרובה ביותר לצורה התקנית: מספר
     שהאפס המוביל שלו נשמר עדיף על תא אקסל שאכל אותו, וצורה מקומית קריאה עדיפה
     על ‎+972. בלי זה המיזוג היה שומר את הכתיבה שבמקרה הופיעה ראשונה. */
  function spellingRank(value) {
    const raw = String(value == null ? "" : value).trim();
    const digits = raw.replace(/\D/g, "");
    if (/^0\d/.test(digits)) return 0;
    if (raw.startsWith("+") || digits.startsWith("972") || digits.startsWith("00")) return 1;
    return 2; // חסר האפס המוביל
  }

  /* כל המספרים השונים בקבוצה, בלי כפילויות, עם השדה שבו כל אחד יושב היום. */
  function distinctNumbers(contacts) {
    const byKey = new Map();
    for (const contact of contacts) {
      for (const field of PHONE_FIELDS) {
        const value = String(contact[field] || "").trim();
        const key = normalizePhone(value);
        if (!value || !key) continue;
        const seen = byKey.get(key);
        if (!seen) { byKey.set(key, { value, field }); continue; }
        // אותו מספר בכתיבה טובה יותר מחליף את זו שנשמרה, אך שומר על השדה
        // המקורי כדי שהצעת השיוך לא תזוז בגלל הבדל בעיצוב בלבד.
        if (spellingRank(value) < spellingRank(seen.value)) seen.value = value;
      }
    }
    return [...byKey.values()];
  }

  /* ---------------- שמות ---------------- */

  /* מפתח שם להשוואת כפולים בלבד, לעולם לא לתצוגה: מוריד סימונים שמשתנים באופן
     לגיטימי בין ייצואים של "אותו" איש קשר (סיומות ‎_1/‎_2, מקפים, ספרות, גרשיים). */
  function nameKey(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[-_"'׳״]/g, "")
      .replace(/[0-9]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const FUZZY_NAME_MIN_SIMILARITY = 0.85;
  const FUZZY_NAME_MIN_LENGTH = 5;

  /* 1 = זהה אחרי נרמול; 0 = לא קשור. שם קצר שמוכל בארוך מקבל ציון לפי כמה הוא
     מכסה ממנו, ולכן "גילה שטיב"/"גילה שטיבל" (0.9) הוא התאמה כמעט ודאית ואילו
     "אורי"/"אורית צדקיה" (0.36) אינו. */
  function nameSimilarity(a, b) {
    const ka = nameKey(a), kb = nameKey(b);
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    const short = ka.length <= kb.length ? ka : kb;
    const long = ka.length <= kb.length ? kb : ka;
    return long.includes(short) ? short.length / long.length : 0;
  }

  /* שם לבדו הוא ראיה חלשה, ולכן שם דומה-אך-לא-זהה מקשר שני כרטיסים רק כשהוא
     כמעט כל השם וגם ארוך מספיק כדי להיות מבחין. */
  function namesLinkContacts(a, b) {
    const sim = nameSimilarity(a, b);
    if (sim === 1) return true;
    if (sim < FUZZY_NAME_MIN_SIMILARITY) return false;
    return Math.min(nameKey(a).length, nameKey(b).length) >= FUZZY_NAME_MIN_LENGTH;
  }

  /* בחירת "הארוך ביותר" לפי אורך גולמי שגויה כשהתוספת היא זבל (סיומת "_1", מקף
     תלוש): "מרים הריס_" היה מנצח את "מרים הריס" על אורך בלבד למרות שהוא המלוכלך.
     משווים קודם לפי האורך הנקי, ורק בתיקו — אותו תוכן אמיתי — מעדיפים את
     המחרוזת הגולמית הקצרה, כלומר זו בלי הזבל. */
  function pickBestName(names) {
    if (!names.length) return "";
    let best = 0;
    for (let i = 1; i < names.length; i++) {
      const ci = nameKey(names[i]).length, cb = nameKey(names[best]).length;
      if (ci > cb || (ci === cb && names[i].length < names[best].length)) best = i;
    }
    return names[best];
  }

  /* ---------------- ניקוד קבוצה ---------------- */

  function compareKey(field, value) {
    if (PHONE_FIELDS.includes(field)) return normalizePhone(value);
    return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function fieldValues(contacts, field) {
    const seen = new Set();
    const out = [];
    for (const contact of contacts) {
      const value = String(contact[field] || "").trim();
      if (value && !seen.has(value)) { seen.add(value); out.push(value); }
    }
    return out;
  }

  /* שדה נספר רק אם לפחות כרטיס אחד מילא אותו — שדה ריק אינו הסכמה אלא היעדר
     מידע, וספירה שלו ניפחה כל ציון. שדה "מתנגש" רק כששני כרטיסים מחזיקים ערכים
     שונים ולא-ריקים; מלא-מול-ריק מתמזג באופן דטרמיניסטי ואינו שאלה למשתמש.
     אפס התנגשויות => אין מה לשאול => מתאים למיזוג בלחיצה אחת. */
  function scoreGroup(contacts) {
    const conflicts = [], missing = [];
    let matched = 0, total = 0, exact = true;
    for (const field of FIELDS) {
      const keys = contacts.map((c) => compareKey(field, c[field]));
      const filled = keys.filter(Boolean);
      if (!filled.length) continue; // אף כרטיס לא מילא — לא ראיה לכאן ולא לכאן
      total++;
      if (new Set(filled).size > 1) { conflicts.push(field); exact = false; }
      else { matched++; if (filled.length !== keys.length) { missing.push(field); exact = false; } }
    }
    return {
      conflicts, missing, exact, matched, total,
      score: total ? matched / total : 1,
      safe: conflicts.length === 0
    };
  }

  /* ---------------- איתור הקבוצות ---------------- */

  function pairKey(a, b) { return [a, b].sort().join("|"); }
  function addIndex(map, key, index) {
    const bucket = map.get(key);
    if (bucket) bucket.push(index); else map.set(key, [index]);
  }

  /* ערך שחוזר על עצמו על כל כך הרבה כרטיסים מפסיק להיות סימן זהות: מספר כזה
     הוא מרכזייה או קו משרד משותף, ושם כזה הוא שם ממלא-מקום ("איש קשר", "לקוח")
     או שארית של שם שכולו היה ספרות ש-nameKey מוריד. בשני המקרים הערך לבדו כבר
     לא מקשר, וצריך אות נוסף. */
  const CROWD = 6;
  const SHARED_PHONE_CROWD = CROWD; // שם ותיק, נשמר לתאימות

  /* חסימה שלא מפילה כלום. התאמה מקורבת פירושה שהמפתח הקצר הוא תת-מחרוזת של
     הארוך ומכסה ממנו ‎85%+, והיא דורשת לפחות 5 תווים — ולכן שני המפתחות חולקים
     בהכרח כל 5-גרם של הקצר. אינדוקס שמות לפי 5-גרם מגיע אפוא לכל זוג שסריקת
     כל-הזוגות הישנה הגיעה אליו, בלי המחיר הריבועי שלה.
     (גרסה 2.0 חסמה לפי אות ראשונה + חצי אורך השם, מה ששם את "משה בן דוד"
     ו"משה בן דודי" בדליים שונים ואיבד בשקט כמחצית מההתאמות המקורבות.) */
  const NAME_GRAM = FUZZY_NAME_MIN_LENGTH;

  function findDuplicateGroups(contacts, options) {
    const opts = options || {};
    const separated = new Set(opts.separatedPairs || []);
    const n = contacts.length;
    if (n < 2) return [];

    const parent = new Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

    /* הראיות נשמרות כ"חבורות" — קבוצות שכל חבריהן קשורים הדדית זה לזה (אותו
       מספר, אותו מייל, אותו שם) — ולא כרשימת זוגות. חבורה של m חברים עולה m
       ולא m², וזה ההבדל בין סריקה מיידית לבין דקה של המתנה ברשימה שבה אלפי
       שמות מתנרמלים לאותו מפתח ("איש קשר 1", "איש קשר 2", …). */
    const cliques = [];
    const memberOf = contacts.map(() => new Set());
    const registerClique = (indices) => {
      if (indices.length < 2) return;
      const cliqueId = cliques.length;
      cliques.push(new Set(indices));
      for (const i of indices) memberOf[i].add(cliqueId);
      for (let k = 1; k < indices.length; k++) union(indices[0], indices[k]);
    };

    const weakPairs = new Map(); // pairKey -> [i, j] — שם דומה אך המספרים סותרים

    const phoneKeys = contacts.map((c) => {
      const keys = new Set();
      for (const field of PHONE_FIELDS) { const key = normalizePhone(c[field]); if (key) keys.add(key); }
      return keys;
    });
    const nameKeys = contacts.map((c) => nameKey(c.name));
    const sharesPhone = (i, j) => { for (const key of phoneKeys[i]) if (phoneKeys[j].has(key)) return true; return false; };

    // טלפון או מייל משותפים — האותות החזקים ביותר, ומקשרים בלי קשר לשם.
    const shared = new Map();
    contacts.forEach((c, i) => {
      for (const key of phoneKeys[i]) addIndex(shared, "tel:" + key, i);
      const email = String(c.email || "").trim().toLowerCase();
      if (email) addIndex(shared, "mail:" + email, i);
    });
    for (const [key, indices] of shared) {
      if (indices.length < 2) continue;
      if (key.startsWith("tel:") && indices.length >= CROWD) {
        // מרכזייה: המספר מקשר רק כרטיסים שגם השם שלהם מתאים.
        const byName = new Map();
        for (const i of indices) if (nameKeys[i]) addIndex(byName, nameKeys[i], i);
        for (const sameName of byName.values()) registerClique(sameName);
        continue;
      }
      registerClique(indices);
    }

    // שמות זהים לחלוטין אחרי נרמול.
    const byNameKey = new Map();
    contacts.forEach((_, i) => { if (nameKeys[i]) addIndex(byNameKey, nameKeys[i], i); });
    for (const indices of byNameKey.values()) {
      if (indices.length < CROWD) { registerClique(indices); continue; }
      // שם צפוף אינו מזהה אדם. מי שגם חולק מספר כבר קושר בסבב הטלפונים; מה
      // שנשאר כאן הם כרטיסים בלי מספר כלל, ואצלם השם הוא כל המידע שיש.
      registerClique(indices.filter((i) => !phoneKeys[i].size));
    }

    /* שמות דומים. ההשוואה תלויה במפתח השם בלבד, ולכן משווים בין המפתחות השונים
       ולא בין הכרטיסים: רשימה עם 5000 "איש קשר <מספר>" מצטמצמת למפתח יחיד. */
    const keys = [...byNameKey.keys()];
    const grams = new Map();
    keys.forEach((key, k) => {
      for (let p = 0; p + NAME_GRAM <= key.length; p++) addIndex(grams, key.slice(p, p + NAME_GRAM), k);
    });
    const tested = new Set();
    for (const bucket of grams.values()) {
      for (let a = 0; a < bucket.length; a++) {
        for (let b = a + 1; b < bucket.length; b++) {
          const ka = Math.min(bucket[a], bucket[b]), kb = Math.max(bucket[a], bucket[b]);
          const seen = ka * keys.length + kb;
          if (tested.has(seen)) continue;
          tested.add(seen);
          if (!namesLinkContacts(keys[ka], keys[kb])) continue;
          for (const i of byNameKey.get(keys[ka])) {
            for (const j of byNameKey.get(keys[kb])) {
              // שני כרטיסים שלכל אחד יש מספרים ואף אחד לא משותף הם ככל הנראה
              // אנשים שונים, ככל שהשמות דומים — אבל זו הערכה, ולכן זה הופך
              // לפריט בדיקה במקום להיעלם בשקט (כפי שקרה ב-2.0).
              if (phoneKeys[i].size && phoneKeys[j].size && !sharesPhone(i, j)) {
                weakPairs.set(pairKey(contacts[i].id, contacts[j].id), [i, j]);
                continue;
              }
              registerClique([i, j]);
            }
          }
        }
      }
    }

    const clusters = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      const bucket = clusters.get(root);
      if (bucket) bucket.push(i); else clusters.set(root, [i]);
    }

    const covers = (cliqueId, members) => members.every((i) => cliques[cliqueId].has(i));

    const groups = [];
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      for (const part of splitSeparated(members, contacts, memberOf, cliques, separated)) {
        if (part.length < 2) continue;
        // קבוצה "מורכבת" היא שרשרת התאמות ולא התאמה הדדית: אין ראיה אחת שמכסה
        // את כל חבריה, ולכן היא נבדקת ידנית ולא ממוזגת אוטומטית.
        const complex = ![...memberOf[part[0]]].some((cliqueId) => covers(cliqueId, part));
        groups.push(buildGroup(part.map((i) => contacts[i]), complex, false));
      }
    }
    for (const [key, pair] of weakPairs) {
      const [i, j] = pair;
      if (separated.has(key)) continue;    // המשתמש כבר קבע שאלה לא אותו אדם
      if (find(i) === find(j)) continue;   // אות חזק יותר כבר חיבר אותם
      groups.push(buildGroup([contacts[i], contacts[j]], false, true));
    }

    // ודאויות קודם, אחר כך לפי ציון, ואז הקבוצות הקטנות (הכי קל להכריע בהן).
    groups.sort((a, b) =>
      Number(a.weak) - Number(b.weak) ||
      Number(b.exact) - Number(a.exact) ||
      Number(b.safe) - Number(a.safe) ||
      b.score - a.score ||
      a.contacts.length - b.contacts.length);
    return groups;
  }

  /* קבוצה שהמשתמש הכריע על חלק מהזוגות בתוכה מפורקת מחדש: מחברים רק חברים
     שחולקים ראיה שלא נפסלה. כך "השאר נפרדים" עובד גם בקבוצה של שלושה ומעלה,
     ולא רק על זוג בודד כפי שהיה ב-2.0. */
  function splitSeparated(members, contacts, memberOf, cliques, separated) {
    if (!separated.size) return [members];
    const vetoed = members.some((i, a) =>
      members.slice(a + 1).some((j) => separated.has(pairKey(contacts[i].id, contacts[j].id))));
    if (!vetoed) return [members];

    const parent = new Map(members.map((i) => [i, i]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const i = members[a], j = members[b];
        if (separated.has(pairKey(contacts[i].id, contacts[j].id))) continue;
        const linked = [...memberOf[i]].some((cliqueId) => cliques[cliqueId].has(j));
        if (!linked) continue;
        const ra = find(i), rb = find(j);
        if (ra !== rb) parent.set(rb, ra);
      }
    }
    const parts = new Map();
    for (const i of members) {
      const root = find(i);
      const bucket = parts.get(root);
      if (bucket) bucket.push(i); else parts.set(root, [i]);
    }
    return [...parts.values()];
  }

  function buildGroup(list, complex, weak) {
    const group = Object.assign({
      key: list.map((c) => c.id).sort().join(","),
      contacts: list,
      weak: Boolean(weak),
      complex: Boolean(complex)
    }, scoreGroup(list));
    if (weak) { group.safe = false; group.exact = false; }
    group.category = categorize(group);
    return group;
  }

  /* ---------------- קטגוריות: הסדר שבו האשף עובר על הכל ---------------- */

  const CATEGORIES = [
    { key: "exact",  icon: "✓", title: "זהים לגמרי",           desc: "אותו שם ואותם פרטים — אין מה לשאול",        tone: "ok",   bulk: "מזג את כולם" },
    { key: "safe",   icon: "✓", title: "מיזוג בטוח",            desc: "אין סתירה, רק פרטים שחסרים בכרטיס אחד",     tone: "ok",   bulk: "מזג את כולם" },
    { key: "name",   icon: "א", title: "שם שונה",               desc: "אותו מספר, השם נכתב אחרת",                  tone: "warn", bulk: "אשר את השם המוצע בכולם" },
    { key: "phone",  icon: "☎", title: "מספרים שונים",          desc: "אותו שם, מספרים שונים",                     tone: "warn", bulk: "אשר את השיוך המוצע בכולם" },
    { key: "both",   icon: "⚠", title: "שם ומספרים שונים",      desc: "שתי ההחלטות באותו מסך",                     tone: "warn", bulk: "אשר את ההצעה בכולם" },
    { key: "other",  icon: "✎", title: "מייל או הערה שונים",    desc: "אין כאן ברירת מחדל נכונה — צריך לבחור",     tone: "warn", bulk: "" },
    { key: "weak",   icon: "?", title: "שם דומה, מספרים שונים", desc: "יכול להיות אותו אדם ויכול שלא — ההחלטה שלכם", tone: "risk", bulk: "" }
  ];

  function categorize(group) {
    if (group.weak) return "weak";
    if (group.exact) return "exact";
    if (group.safe) return "safe";
    const nameConflict = group.conflicts.includes("name");
    const phoneConflict = group.conflicts.some((f) => PHONE_FIELDS.includes(f));
    if (nameConflict && phoneConflict) return "both";
    if (nameConflict) return "name";
    if (phoneConflict) return "phone";
    return "other";
  }

  /* הקטגוריות שיש בהן משהו, בסדר הקבוע, כל אחת עם הקבוצות שלה. */
  function buildQueue(groups) {
    return CATEGORIES
      .map((meta) => Object.assign({}, meta, { groups: groups.filter((g) => g.category === meta.key) }))
      .filter((entry) => entry.groups.length > 0);
  }

  /* קטגוריה שאפשר לאשר בבת אחת: יש לה ברירת מחדל שנכון לסמוך עליה בלי לשאול.
     "מייל או הערה שונים" ו"שם דומה" אינם כאלה — אין דרך עקרונית לבחור עבור
     המשתמש בין שני ערכים שונים באמת. */
  function canBulkApply(categoryKey) {
    const meta = CATEGORIES.find((c) => c.key === categoryKey);
    return Boolean(meta && meta.bulk);
  }

  /* ---------------- מיזוג ---------------- */

  /* ההצעה שהמסך מציג ושהמיזוג האוטומטי מיישם: השם הנקי ביותר, וכל מספר במשבצת
     שהקידומת שלו מכתיבה. זו נקודת האמת האחת — מסך השאלות והאישור-הגורף מקבלים
     בדיוק את אותה הצעה, ולכן "אשר הכל" תמיד עושה מה שהמסך הראה. */
  function proposeMerge(contacts) {
    const numbers = distinctNumbers(contacts);
    const slots = suggestPhoneSlots(numbers.map((x) => x.value), numbers.map((x) => x.field));
    const phones = { mobile: "", home: "", work: "", fax: "" };
    numbers.forEach((num, i) => { const slot = slots[i]; if (slot && !phones[slot]) phones[slot] = num.value; });
    return {
      name: pickBestName(fieldValues(contacts, "name")),
      phones,
      numbers: numbers.map((num, i) => ({ value: num.value, slot: slots[i] })),
      email: fieldValues(contacts, "email")[0] || "",
      note: fieldValues(contacts, "note")[0] || ""
    };
  }

  /* הכרטיס הממוזג. choices דורס כל שדה; מה שלא נבחר נופל בחזרה להצעה. */
  function mergeContacts(contacts, choices) {
    const picks = choices || {};
    const proposal = proposeMerge(contacts);
    const out = { name: picks.name != null ? picks.name : proposal.name };
    const phones = picks.phones || proposal.phones;
    for (const field of PHONE_FIELDS) out[field] = phones[field] || "";
    for (const field of ["email", "note"]) out[field] = picks[field] != null ? picks[field] : proposal[field];
    return out;
  }

  /* ---------------- סימונים בשמות ---------------- */

  function symbolsInName(name) {
    const value = String(name == null ? "" : name);
    const found = new Map();
    if (/_\d+/.test(value)) found.set("_מספר", { label: "סיומת מספר (כגון _1, _2)" });
    if (/_/.test(value.replace(/_\d+/gu, ""))) found.set("_", { label: "קו תחתון (_)" });
    // כל תו שאינו עברית, ניקוד, אנגלית, ספרה, רווח או גרש/מקף לגיטימיים.
    for (const match of value.replace(/_\d+/gu, "").replace(/_/gu, "").matchAll(/[^א-ת֑-ׇa-zA-Z0-9\s'"׳״\-]/gu)) {
      if (!found.has(match[0])) found.set(match[0], { label: `תו מיוחד: "${match[0]}"` });
    }
    return found;
  }

  function patternRegex(key) {
    if (key === "_מספר") return /_\d+/gu;
    if (key === "_") return /_/gu;
    return new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu");
  }

  function applyPatternRemove(name, key) {
    return String(name == null ? "" : name).replace(patternRegex(key), "").replace(/\s{2,}/gu, " ").trim();
  }

  /* כל סוגי הסימונים ברשימה, הנפוץ קודם, עם אנשי הקשר שנושאים כל אחד. */
  function findSymbolGroups(contacts) {
    const groups = new Map();
    for (const contact of contacts) {
      for (const [key, info] of symbolsInName(contact.name)) {
        let group = groups.get(key);
        if (!group) { group = { key, label: info.label, contacts: [] }; groups.set(key, group); }
        group.contacts.push(contact);
      }
    }
    return [...groups.values()].sort((a, b) => b.contacts.length - a.contacts.length);
  }

  const api = {
    PHONE_FIELDS, FIELDS, LABELS, CATEGORIES,
    FUZZY_NAME_MIN_SIMILARITY, FUZZY_NAME_MIN_LENGTH, SHARED_PHONE_CROWD,
    normalizePhone, guessPhoneKind, suggestPhoneSlots, distinctNumbers,
    nameKey, nameSimilarity, namesLinkContacts, pickBestName,
    compareKey, fieldValues, scoreGroup, pairKey,
    findDuplicateGroups, categorize, buildQueue, canBulkApply,
    proposeMerge, mergeContacts,
    symbolsInName, patternRegex, applyPatternRemove, findSymbolGroups
  };

  root.ANKAL_DEDUPE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
