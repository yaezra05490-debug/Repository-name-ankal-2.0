/* vCard 2.1 / 3.0 / 4.0 reader and vCard 3.0 writer. */
(function (root) {
  "use strict";

  function unfoldVcf(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const lines = [];
    for (let i = 0; i < raw.length; i++) {
      let line = raw[i];
      while (i + 1 < raw.length && /^[ \t]/.test(raw[i + 1])) line += raw[++i].slice(1);
      const head = line.slice(0, Math.max(0, line.indexOf(":")));
      while (/ENCODING\s*=\s*QUOTED-PRINTABLE/i.test(head) && line.endsWith("=") && i + 1 < raw.length) {
        line = line.slice(0, -1) + raw[++i];
      }
      lines.push(line);
    }
    return lines;
  }

  function splitOutsideQuotes(value, separator) {
    const out = [];
    let current = "";
    let quoted = false;
    for (const char of value) {
      if (char === '"') quoted = !quoted;
      if (char === separator && !quoted) { out.push(current); current = ""; }
      else current += char;
    }
    out.push(current);
    return out;
  }

  function parseLine(line) {
    const colon = line.indexOf(":");
    if (colon < 0) return null;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const parts = splitOutsideQuotes(left, ";");
    const rawName = parts.shift() || "";
    const name = rawName.split(".").pop().toUpperCase();
    const params = {};
    for (const part of parts) {
      const eq = part.indexOf("=");
      const key = eq < 0 ? "TYPE" : part.slice(0, eq).trim().toUpperCase();
      const rawValue = eq < 0 ? part : part.slice(eq + 1);
      const values = splitOutsideQuotes(rawValue, ",").map(v => v.trim().replace(/^"|"$/g, "").toUpperCase()).filter(Boolean);
      params[key] = (params[key] || []).concat(values);
    }
    return { name, params, value };
  }

  function bytesFromBase64(value) {
    const clean = String(value || "").replace(/\s/g, "");
    if (typeof atob === "function") return Uint8Array.from(atob(clean), ch => ch.charCodeAt(0));
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(clean, "base64"));
    throw new Error("Base64 is not supported in this environment");
  }

  function decodeBytes(bytes, charset) {
    const requested = String(charset || "utf-8").toLowerCase().replace("windows-1255", "windows-1255");
    try { return new TextDecoder(requested).decode(bytes); }
    catch (_) { return new TextDecoder("utf-8").decode(bytes); }
  }

  function decodeQuotedPrintable(value, charset) {
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "=" && /^[0-9a-f]{2}$/i.test(value.slice(i + 1, i + 3))) {
        bytes.push(parseInt(value.slice(i + 1, i + 3), 16)); i += 2;
      } else bytes.push(value.charCodeAt(i) & 255);
    }
    return decodeBytes(new Uint8Array(bytes), charset);
  }

  function decodeValue(value, params) {
    const encoding = (params.ENCODING || []).join(",");
    const charset = (params.CHARSET || ["utf-8"])[0];
    let decoded = value;
    if (/QUOTED-PRINTABLE/i.test(encoding)) decoded = decodeQuotedPrintable(value, charset);
    else if (/^(B|BASE64)$/i.test(encoding)) decoded = decodeBytes(bytesFromBase64(value), charset);
    let out = "";
    for (let i = 0; i < decoded.length; i++) {
      if (decoded[i] !== "\\") { out += decoded[i]; continue; }
      const next = decoded[++i];
      if (next == null) { out += "\\"; break; }
      if (next.toLowerCase() === "n") out += "\n";
      else if (next === "," || next === ";" || next === "\\") out += next;
      else out += next;
    }
    return out;
  }

  function displayNameFromN(value) {
    const bits = value.split(";").map(v => v.trim());
    const family = bits[0] || "", given = bits[1] || "", middle = bits[2] || "", prefix = bits[3] || "", suffix = bits[4] || "";
    return [prefix, given, middle, family, suffix].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function parseVcfDetailed(text) {
    const contacts = [];
    const warnings = [];
    let current = null;
    const finish = incomplete => {
      if (!current) return;
      if (current.name || current.phones.length || current.emails.length || current.note) {
        if (!current.name) current.name = "ללא שם";
        contacts.push(current);
        if (incomplete) warnings.push("איש הקשר האחרון בקובץ היה חסר שורת סיום ושוחזר.");
      }
      current = null;
    };
    for (const original of unfoldVcf(text)) {
      const line = original.replace(/^\s+/, "");
      const upper = line.trim().toUpperCase();
      if (upper === "BEGIN:VCARD") { if (current) finish(true); current = { name: "", note: "", phones: [], emails: [] }; continue; }
      if (upper === "END:VCARD") { finish(false); continue; }
      if (!current || !line.trim()) continue;
      const parsed = parseLine(line);
      if (!parsed) { warnings.push("נמצאה שורה שלא ניתן היה לקרוא."); continue; }
      const value = decodeValue(parsed.value, parsed.params);
      if (parsed.name === "FN") current.name = value.trim();
      else if (parsed.name === "N" && !current.name) current.name = displayNameFromN(value);
      else if (parsed.name === "TEL") {
        const type = (parsed.params.TYPE || []).join("/");
        current.phones.push({ value: value.trim().replace(/^tel:/i, ""), type });
      } else if (parsed.name === "EMAIL") current.emails.push({ value: value.trim().replace(/^mailto:/i, ""), type: (parsed.params.TYPE || []).join("/") });
      else if (parsed.name === "NOTE") current.note = value;
    }
    if (current) finish(true);
    return { contacts, warnings };
  }

  function parseVcf(text) { return parseVcfDetailed(text).contacts; }

  function escapeValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  }

  function byteLength(value) { return new TextEncoder().encode(value).length; }
  function foldLine(line, limit = 75) {
    if (byteLength(line) <= limit) return line;
    const chunks = [];
    let chunk = "";
    for (const char of line) {
      const candidate = chunk + char;
      const currentLimit = chunks.length ? limit - 1 : limit;
      if (chunk && byteLength(candidate) > currentLimit) { chunks.push(chunk); chunk = char; }
      else chunk = candidate;
    }
    if (chunk) chunks.push(chunk);
    return chunks.map((part, index) => index ? " " + part : part).join("\r\n");
  }

  const PHONE_TYPE = { mobile: "CELL", home: "HOME", work: "WORK", fax: "FAX" };
  function buildVcf(contacts) {
    const lines = [];
    for (const contact of contacts || []) {
      lines.push("BEGIN:VCARD", "VERSION:3.0");
      lines.push(foldLine("FN:" + escapeValue(contact.name || "ללא שם")));
      lines.push(foldLine("N:" + escapeValue(contact.name || "ללא שם") + ";;;;"));
      for (const field of Object.keys(PHONE_TYPE)) if (contact[field]) lines.push(foldLine(`TEL;TYPE=${PHONE_TYPE[field]}:${escapeValue(contact[field])}`));
      if (contact.email) lines.push(foldLine("EMAIL:" + escapeValue(contact.email)));
      if (contact.note) lines.push(foldLine("NOTE:" + escapeValue(contact.note)));
      lines.push("END:VCARD");
    }
    return lines.join("\r\n") + (lines.length ? "\r\n" : "");
  }

  const api = { parseVcf, parseVcfDetailed, buildVcf, unfoldVcf, parseLine, displayNameFromN, foldLine };
  Object.assign(root, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
