const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const config = require("./app-config.json");
let mainWindow;
const b64url = buffer => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 880, minHeight: 600, backgroundColor: "#0b1220", title: 'אנק"ל', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false } });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("file://")) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
}

ipcMain.handle("ankal:google-login", () => systemGoogleLogin());
ipcMain.handle("ankal:save-workspace", (_, json) => atomicSave(json));
ipcMain.handle("ankal:check-update", async () => { try { const response = await fetch(config.siteUrl.replace(/\/$/, "") + "/version.json"); return { ...(await response.json()), current: app.getVersion() }; } catch (_) { return null; } });

/* לקוח OAuth מסוג Desktop אצל גוגל דורש client_secret בהחלפת הקוד לטוקן, גם
   כשמשתמשים ב-PKCE. בלעדיו גוגל מחזיר "client_secret is missing" וההתחברות
   נכשלת. גוגל עצמה מציינת שהסוד הזה אינו חסוי באמת באפליקציות מותקנות — הוא
   ממילא ארוז בתוך הקובץ שמורידים — ולכן הוא יושב ב-app-config.json. */
async function systemGoogleLogin() {
  if (!config.googleDesktopClientId || config.googleDesktopClientId.includes("PASTE_")) throw new Error("DESKTOP_CLIENT_ID_NOT_CONFIGURED");
  if (!config.googleDesktopClientSecret || config.googleDesktopClientSecret.includes("PASTE_")) throw new Error("DESKTOP_CLIENT_SECRET_NOT_CONFIGURED");
  const verifier = b64url(crypto.randomBytes(48)), challenge = b64url(crypto.createHash("sha256").update(verifier).digest()), state = b64url(crypto.randomBytes(24));
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const callback = new URL(req.url, "http://127.0.0.1"); if (callback.pathname !== "/oauth/callback") { res.writeHead(404); return res.end(); }
        if (callback.searchParams.get("state") !== state) throw new Error("INVALID_OAUTH_STATE"); const code = callback.searchParams.get("code"); if (!code) throw new Error("LOGIN_CANCELLED");
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
        const body = new URLSearchParams({ client_id: config.googleDesktopClientId, client_secret: config.googleDesktopClientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri });
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        const tokens = await tokenResponse.json();
        // הסיבה האמיתית מגיעה מגוגל. בלעדיה כל תקלה נראית זהה, וזה מה שהקשה
        // לאתר שהחסר היחיד היה client_secret.
        if (!tokenResponse.ok || !tokens.id_token) throw new Error("TOKEN_EXCHANGE_FAILED: " + (tokens.error_description || tokens.error || tokenResponse.status));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end("<!doctype html><meta charset=utf-8><title>אנק״ל</title><body dir=rtl style='font-family:Arial;padding:40px'><h1>הכניסה הושלמה</h1><p>אפשר לסגור את החלון ולחזור לאנק״ל.</p></body>"); resolve({ idToken: tokens.id_token }); setTimeout(() => server.close(), 500);
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><meta charset=utf-8><title>אנק״ל</title><body dir=rtl style='font-family:Arial;padding:40px'>"
          + "<h1>הכניסה לא הושלמה</h1><p>אפשר לסגור את החלון ולנסות שוב.</p>"
          + "<p style='color:#777;font-size:13px'>פרטים טכניים: " + String(error.message || error).replace(/[<>&]/g, "") + "</p></body>");
        reject(error); server.close();
      }
    });
    server.listen(0, "127.0.0.1", () => { const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`; const params = new URLSearchParams({ client_id: config.googleDesktopClientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", code_challenge: challenge, code_challenge_method: "S256", state, prompt: "select_account" }); shell.openExternal("https://accounts.google.com/o/oauth2/v2/auth?" + params); });
    setTimeout(() => { if (server.listening) { server.close(); reject(new Error("LOGIN_TIMEOUT")); } }, 180000);
  });
}

function atomicSave(json) {
  if (typeof json !== "string" || json.length > 30000000) return false;
  const target = path.join(app.getPath("userData"), "workspace.json"), temp = target + ".tmp", previous = target + ".previous"; JSON.parse(json); fs.writeFileSync(temp, json, "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); if (fs.existsSync(target)) fs.copyFileSync(target, previous); fs.renameSync(temp, target); return true;
}
app.whenReady().then(() => { createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
