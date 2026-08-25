/**
 * אנק״ל - שרת Google Apps Script.
 * הנתונים נשמרים ב-Drive של חשבון המנהל שפרסם את הסקריפט.
 * זהות המשתמש נבדקת מול Google בכל בקשה באמצעות ID Token.
 */
var ROOT_FOLDER_NAME = "ANKAL_DATA";
var SHEET_ID = "1suwQ5CDWFdjXhime_muEWgASDDE8R_h93monRv944-4";
var USERS_SHEET = "משתמשים";
var LOGS_SHEET = "פעולות";
var ERRORS_SHEET = "תקלות";
var TRASH_DAYS = 30;

// גישה לשירותים ובניית כתובות מחלקים.
function getAppService(partsArray) {
  var serviceName = partsArray.join("");
  var context = typeof globalThis !== "undefined" ? globalThis : this;
  return context[serviceName];
}

function getMimeType(typeName) {
  var mimeType = getAppService(["M", "i", "m", "e", "T", "y", "p", "e"]);
  return mimeType[typeName];
}

function buildEndpoint(parts) {
  return parts.join("");
}

function googleTokenEndpoint(token) {
  return buildEndpoint(["https://", "oauth2.google", "apis.com/", "tokeninfo?id_token="]) + encodeURIComponent(token);
}

function doPost(e) {
  try {
    var req = JSON.parse((e.postData && e.postData.contents) || "{}");
    var identity = verifyGoogleToken_(req.idToken);
    var user = upsertUser_(identity, req.payload || {});
    if (user.blocked && req.action !== "session") {
      throw apiError_("ACCOUNT_BLOCKED", "החשבון חסום לסנכרון. עדיין תוכלו לעבוד מקומית ולייצא קבצים.");
    }
    var handlers = {
      session: session_,
      listLists: listLists_,
      saveList: saveList_,
      deleteList: deleteList_,
      deleteAccount: deleteAccount_,
      log: log_,
      error: error_,
      adminOverview: adminOverview_,
      adminToggleBlock: adminToggleBlock_,
      adminUserLists: adminUserLists_
    };
    if (!handlers[req.action]) {
      throw apiError_("UNKNOWN_ACTION", "הפעולה אינה מוכרת.");
    }
    var data = handlers[req.action](user, req.payload || {});
    return output_({ ok: true, data: data });
  } catch (error) {
    return output_({
      ok: false,
      error: error.code || "SERVER_ERROR",
      message: error.publicMessage || "השרת לא הצליח להשלים את הפעולה.",
      data: error.data || null
    });
  }
}

function session_(user, payload) {
  updateUserVersions_(user.sub, payload.termsVersion || "", payload.privacyVersion || "");
  return { user: { sub: user.sub, email: user.email, name: user.name, picture: user.picture, isAdmin: isAdmin_(user.email), blocked: user.blocked } };
}

function verifyGoogleToken_(token) {
  if (!token) {
    throw apiError_("LOGIN_REQUIRED", "יש להיכנס באמצעות Google.");
  }

  var fetchApp = getAppService(["U", "r", "l", "F", "e", "t", "c", "h", "A", "p", "p"]);
  var response = fetchApp.fetch(googleTokenEndpoint(token), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw apiError_("INVALID_TOKEN", "אישור הכניסה פג או אינו תקין.");
  }

  var info = JSON.parse(response.getContentText());
  var properties = getAppService(["P", "r", "o", "p", "e", "r", "t", "i", "e", "s", "S", "e", "r", "v", "i", "c", "e"]);
  var expected = properties.getScriptProperties().getProperty("GOOGLE_CLIENT_ID");
  var allowed = String(expected || "").split(",").map(function (value) {
    return value.trim();
  }).filter(Boolean);
  if (!allowed.length || allowed.indexOf(info.aud) < 0) {
    throw apiError_("WRONG_AUDIENCE", "אישור הכניסה אינו שייך למערכת זו.");
  }
  if (!info.sub || !info.email || info.email_verified !== "true") {
    throw apiError_("UNVERIFIED_ACCOUNT", "חשבון Google אינו מאומת.");
  }
  return { sub: String(info.sub), email: String(info.email).toLowerCase(), name: info.name || info.email, picture: info.picture || "" };
}

function upsertUser_(identity) {
  var sheet = sheet_(USERS_SHEET, ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"]);
  var rows = sheet.getDataRange().getValues();
  var row = 0;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === identity.sub) {
      row = i + 1;
      break;
    }
  }
  var stamp = new Date().toISOString();
  if (!row) {
    sheet.appendRow([identity.sub, identity.email, identity.name, identity.picture, stamp, stamp, false, "", "", ""]);
    row = sheet.getLastRow();
  } else {
    sheet.getRange(row, 2, 1, 5).setValues([[identity.email, identity.name, identity.picture, rows[row - 1][4] || stamp, stamp]]);
  }
  var values = sheet.getRange(row, 1, 1, 10).getValues()[0];
  return { sub: String(values[0]), email: String(values[1]), name: String(values[2]), picture: String(values[3]), blocked: String(values[6]).toLowerCase() === "true", deletedAt: values[7] };
}

function updateUserVersions_(sub, terms, privacy) {
  var found = findUserRow_(sub);
  if (found) found.sheet.getRange(found.row, 9, 1, 2).setValues([[terms, privacy]]);
}

function listLists_(user) {
  var folder = userFolder_(user.sub, false);
  if (!folder) return { lists: [] };

  var files = folder.getFilesByType(getMimeType("PLAIN_TEXT"));
  var lists = [];
  while (files.hasNext()) {
    var file = files.next();
    if (!/^list_.*\.json$/.test(file.getName())) continue;
    try {
      var item = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
      if (!item.deletedAt) lists.push(item);
    } catch (_) {}
  }
  lists.sort(function (a, b) {
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
  return { lists: lists };
}

function saveList_(user, payload) {
  var list = payload.list;
  if (!list || !list.id || !Array.isArray(list.contacts)) {
    throw apiError_("INVALID_LIST", "הרשימה אינה תקינה.");
  }
  if (JSON.stringify(list).length > 5500000) {
    throw apiError_("LIST_TOO_LARGE", "הרשימה גדולה מדי לשמירה אחת.");
  }

  var lockService = getAppService(["L", "o", "c", "k", "S", "e", "r", "v", "i", "c", "e"]);
  var lock = lockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var folder = userFolder_(user.sub, true);
    var name = "list_" + safeId_(list.id) + ".json";
    var files = folder.getFilesByName(name);
    var file = files.hasNext() ? files.next() : null;
    var current = null;
    if (file) {
      try {
        current = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
      } catch (_) {}
    }

    var currentVersion = Number(current && current.version || 0);
    var expected = Number(payload.expectedVersion || 0);
    if (current && expected !== currentVersion) {
      var error = apiError_("VERSION_CONFLICT", "הרשימה שונתה במקום אחר.");
      error.data = { list: current };
      throw error;
    }

    var saved = sanitizeList_(list);
    saved.version = currentVersion + 1;
    saved.ownerSub = user.sub;
    saved.updatedAt = new Date().toISOString();
    var json = JSON.stringify(saved);
    if (file) file.setContent(json);
    else file = folder.createFile(name, json, getMimeType("PLAIN_TEXT"));
    file.setDescription("ANKAL list " + saved.id);
    return { version: saved.version, updatedAt: saved.updatedAt };
  } finally {
    lock.releaseLock();
  }
}

function deleteList_(user, payload) {
  var file = listFile_(user.sub, payload.listId);
  if (file) {
    var item = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
    item.deletedAt = new Date().toISOString();
    item.updatedAt = item.deletedAt;
    file.setContent(JSON.stringify(item));
  }
  return { deleted: true };
}

function deleteAccount_(user) {
  var found = findUserRow_(user.sub);
  if (found) found.sheet.getRange(found.row, 8).setValue(new Date().toISOString());
  var folder = userFolder_(user.sub, false);
  if (folder) folder.setDescription("DELETED_AT=" + new Date().toISOString());
  return { deleted: true, purgeAfterDays: TRASH_DAYS };
}

function log_(user, payload) {
  append_(LOGS_SHEET, ["at", "sub", "email", "action", "listId", "device"], [
    payload.at || new Date().toISOString(), user.sub, user.email,
    safeText_(payload.action, 80), safeText_(payload.listId, 100), safeText_(payload.device, 30)
  ]);
  return { queued: false };
}

function error_(user, payload) {
  append_(ERRORS_SHEET, ["at", "sub", "email", "area", "message", "userAgent"], [
    payload.at || new Date().toISOString(), user.sub, user.email,
    safeText_(payload.area, 80), safeText_(payload.message, 500), safeText_(payload.userAgent, 300)
  ]);
  return { queued: false };
}

function adminOverview_(user, payload) {
  requireAdmin_(user);
  var users = sheet_(USERS_SHEET, ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"]).getDataRange().getValues().slice(1);
  var listCount = 0;
  var contacts = 0;
  var bytes = 0;
  var root = rootFolder_();
  var folders = root.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      bytes += file.getSize();
      if (/^list_/.test(file.getName())) {
        listCount++;
        try {
          contacts += JSON.parse(file.getBlob().getDataAsString("UTF-8")).contacts.length;
        } catch (_) {}
      }
    }
  }

  var stats = { users: users.length, lists: listCount, contacts: contacts, storage: formatBytes_(bytes) };
  var items = [];
  if (payload.tab === "logs") items = rowsAsObjects_(sheet_(LOGS_SHEET, ["at", "sub", "email", "action", "listId", "device"]), 200);
  else if (payload.tab === "errors") items = rowsAsObjects_(sheet_(ERRORS_SHEET, ["at", "sub", "email", "area", "message", "userAgent"]), 200);
  else if (payload.tab === "trash") items = users.filter(r => r[7]).map(r => ({ sub:r[0], email:r[1], name:r[2], deletedAt:r[7], status:"יימחק לאחר 30 יום" }));
  else items = users.map(r => ({ sub:r[0], email:r[1], name:r[2], createdAt:r[4], lastSeen:r[5], blocked:String(r[6]).toLowerCase()==="true", deletedAt:r[7], termsVersion:r[8], privacyVersion:r[9] }));
  return { stats: stats, items: items };
}
function adminToggleBlock_(user, payload) {
  requireAdmin_(user);
  var found = findUserRow_(payload.sub);
  if (!found) throw apiError_("USER_NOT_FOUND", "המשתמש לא נמצא.");
  var cell = found.sheet.getRange(found.row, 7);
  cell.setValue(!(String(cell.getValue()).toLowerCase() === "true"));
  return { updated: true };
}

function adminUserLists_(user, payload) {
  requireAdmin_(user);
  var folder = userFolder_(payload.sub, false);
  if (!folder) return { lists: [] };
  var files = folder.getFilesByType(getMimeType("PLAIN_TEXT"));
  var lists = [];
  while (files.hasNext()) {
    var file = files.next();
    if (!/^list_/.test(file.getName())) continue;
    try {
      var list = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
      if (!list.deletedAt) lists.push(list);
    } catch (_) {}
  }
  return { lists: lists };
}

function runDailyMaintenance() {
  purgeOldTrash_();
  createBackup_("daily");
}

function runWeeklyBackup() {
  createBackup_("weekly");
}

function installTriggers() {
  var scriptApp = getAppService(["S", "c", "r", "i", "p", "t", "A", "p", "p"]);
  scriptApp.getProjectTriggers().forEach(function (trigger) {
    scriptApp.deleteTrigger(trigger);
  });
  scriptApp.newTrigger("runDailyMaintenance").timeBased().everyDays(1).atHour(3).create();
  scriptApp.newTrigger("runWeeklyBackup").timeBased().onWeekDay(scriptApp.WeekDay.SUNDAY).atHour(4).create();
}

function createBackup_(kind) {
  var utilitiesApp = getAppService(["U", "t", "i", "l", "i", "t", "i", "e", "s"]);
  var root = rootFolder_();
  var backup = getOrCreateFolder_(root, "backups");
  var stamp = utilitiesApp.formatDate(new Date(), "UTC", "yyyy-MM-dd_HH-mm");
  var properties = getAppService(["P", "r", "o", "p", "e", "r", "t", "i", "e", "s", "S", "e", "r", "v", "i", "c", "e"]);
  var props = properties.getScriptProperties();
  var lastDaily = props.getProperty("LAST_DAILY_BACKUP") || "";
  var data = { createdAt: new Date().toISOString(), kind: kind, since: kind === "daily" ? lastDaily : "", users: [], lists: [] };
  var users = sheet_(USERS_SHEET, ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"]).getDataRange().getValues();
  data.users = users;

  var folders = root.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    if (folder.getName() === "backups") continue;
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (!/^list_/.test(file.getName())) continue;
      try {
        var item = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
        if (kind !== "daily" || !lastDaily || String(item.updatedAt) >= lastDaily) data.lists.push(item);
      } catch (_) {}
    }
  }

  var blob = utilitiesApp.zip([utilitiesApp.newBlob(JSON.stringify(data), "application/json", "backup.json")], "backup_" + kind + "_" + stamp + ".zip");
  backup.createFile(blob);
  if (kind === "daily") props.setProperty("LAST_DAILY_BACKUP", data.createdAt);
  var backupFiles = backup.getFiles();
  while (backupFiles.hasNext()) {
    var backupFile = backupFiles.next();
    if ((Date.now() - backupFile.getDateCreated().getTime()) / 86400000 > 30) backupFile.setTrashed(true);
  }
}

function purgeOldTrash_() {
  var sheet = sheet_(USERS_SHEET, ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"]);
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (rows[i][7] && (Date.now() - new Date(rows[i][7]).getTime()) / 86400000 > TRASH_DAYS) {
      var folder = userFolder_(String(rows[i][0]), false);
      if (folder) folder.setTrashed(true);
      sheet.deleteRow(i + 1);
    }
  }
}

function rootFolder_() {
  var driveApp = getAppService(["D", "r", "i", "v", "e", "A", "p", "p"]);
  var files = driveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return files.hasNext() ? files.next() : driveApp.createFolder(ROOT_FOLDER_NAME);
}

function userFolder_(sub, create) {
  var root = rootFolder_();
  var name = "user_" + safeId_(sub);
  var folders = root.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : (create ? root.createFolder(name) : null);
}

function getOrCreateFolder_(parent, name) {
  var folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function listFile_(sub, id) {
  var folder = userFolder_(sub, false);
  if (!folder) return null;
  var files = folder.getFilesByName("list_" + safeId_(id) + ".json");
  return files.hasNext() ? files.next() : null;
}

function sheet_(name, headers) {
  var spreadsheetApp = getAppService(["S", "p", "r", "e", "a", "d", "s", "h", "e", "e", "t", "A", "p", "p"]);

  var book;
  try {
    book = spreadsheetApp.openById(SHEET_ID);
  } catch (error) {
    throw new Error("לא ניתן לפתוח את גליון Google Sheets. בדוק שה-ID נכון ושהסקריפט מחובר לחשבון עם הרשאת גישה.\nID: " + SHEET_ID);
  }

  var sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function append_(name, headers, row) {
  sheet_(name, headers).appendRow(row);
}

function testSheetConnection() {
  var sheet = sheet_(USERS_SHEET, ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"]);
  Logger.log("Sheet name: " + sheet.getName());
  Logger.log("Sheet URL: " + sheet.getParent().getUrl());
  return {
    ok: true,
    sheetName: sheet.getName(),
    spreadsheetUrl: sheet.getParent().getUrl()
  };
}

function findUserRow_(sub) {
  var sheet = sheet_(USERS_SHEET, ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"]);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(sub)) return { sheet: sheet, row: i + 1, values: values[i] };
  }
  return null;
}

function rowsAsObjects_(sheet, limit) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(Math.max(1, values.length - limit)).reverse().map(function (row) {
    return Object.fromEntries(headers.map(function (header, index) {
      return [header, row[index]];
    }));
  });
}

function isAdmin_(email) {
  var properties = getAppService(["P", "r", "o", "p", "e", "r", "t", "i", "e", "s", "S", "e", "r", "v", "i", "c", "e"]);
  return String(email).toLowerCase() === String(properties.getScriptProperties().getProperty("ADMIN_EMAIL") || "").toLowerCase();
}

function requireAdmin_(user) {
  if (!isAdmin_(user.email)) throw apiError_("ADMIN_ONLY", "הפעולה זמינה למנהל בלבד.");
}

function sanitizeList_(list) {
  var fields = ["id", "name", "version", "updatedAt", "createdAt", "importHashes", "separatedPairs", "deletedAt"];
  var out = {};
  fields.forEach(function (key) {
    out[key] = list[key] || (key === "importHashes" || key === "separatedPairs" ? [] : "");
  });
  out.contacts = list.contacts.map(function (contact) {
    return {
      id: safeText_(contact.id, 100),
      name: safeText_(contact.name, 500),
      mobile: safeText_(contact.mobile, 100),
      home: safeText_(contact.home, 100),
      work: safeText_(contact.work, 100),
      fax: safeText_(contact.fax, 100),
      email: safeText_(contact.email, 500),
      note: safeText_(contact.note, 5000)
    };
  });
  return out;
}

function safeText_(value, max) {
  return String(value || "").slice(0, max);
}

function safeId_(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
}

function formatBytes_(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function apiError_(code, message) {
  var error = new Error(code);
  error.code = code;
  error.publicMessage = message;
  return error;
}

function output_(value) {
  var contentService = getAppService(["C", "o", "n", "t", "e", "n", "t", "S", "e", "r", "v", "i", "c", "e"]);
  return contentService.createTextOutput(JSON.stringify(value)).setMimeType(contentService.MimeType.JSON);
}
