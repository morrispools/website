require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const DEFAULT_TEMPLATE =
  "Hi {name}, thanks for choosing Morris Pools! We'd love to hear how we did. " +
  "If you have a minute, please leave us a quick Google review: {link} " +
  "Reply STOP to opt out.";

// ---------- storage helpers ----------

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function getHistory() {
  return readJson(HISTORY_FILE, []);
}

function getSettings() {
  const settings = readJson(SETTINGS_FILE, {});
  return {
    template: settings.template || DEFAULT_TEMPLATE,
    reviewLink: settings.reviewLink || process.env.GOOGLE_REVIEW_LINK || "",
  };
}

// ---------- phone helpers ----------

// Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns null if invalid.
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

function renderTemplate(template, name, link) {
  return template
    .replaceAll("{name}", name)
    .replaceAll("{link}", link)
    .trim();
}

// ---------- Twilio ----------

function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Twilio error (HTTP ${res.status})`);
  }
  return data.sid;
}

// ---------- auth ----------

// Optional shared-password protection: set APP_PASSWORD in .env to enable.
app.use((req, res, next) => {
  const password = process.env.APP_PASSWORD;
  if (!password) return next();

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString();
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === password) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Morris Pools Review Texts"');
  res.status(401).send("Password required");
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- API ----------

app.get("/api/config", (req, res) => {
  const settings = getSettings();
  res.json({
    testMode: !twilioConfigured(),
    template: settings.template,
    reviewLink: settings.reviewLink,
  });
});

app.post("/api/settings", (req, res) => {
  const { template, reviewLink } = req.body || {};
  const current = readJson(SETTINGS_FILE, {});
  if (typeof template === "string" && template.trim()) {
    current.template = template.trim();
  }
  if (typeof reviewLink === "string") {
    current.reviewLink = reviewLink.trim();
  }
  writeJson(SETTINGS_FILE, current);
  res.json({ ok: true });
});

app.get("/api/history", (req, res) => {
  res.json(getHistory().slice().reverse());
});

// Send to one client. Body: { name, phone, force }
// If this number was already texted before, returns { duplicate: true }
// unless force is set — the UI asks for confirmation.
app.post("/api/send", async (req, res) => {
  const { name, phone, force } = req.body || {};

  const cleanName = String(name || "").trim();
  if (!cleanName) {
    return res.status(400).json({ error: "Client name is required." });
  }

  const to = normalizePhone(phone);
  if (!to) {
    return res
      .status(400)
      .json({ error: `"${phone}" doesn't look like a valid US phone number.` });
  }

  const settings = getSettings();
  if (!settings.reviewLink) {
    return res.status(400).json({
      error:
        "No Google review link set yet. Add it in Settings (or GOOGLE_REVIEW_LINK in .env).",
    });
  }

  const history = getHistory();
  const previous = history.find((h) => h.phone === to && h.status === "sent");
  if (previous && !force) {
    return res.json({
      duplicate: true,
      previousDate: previous.date,
      previousName: previous.name,
    });
  }

  const firstName = cleanName.split(/\s+/)[0];
  const body = renderTemplate(settings.template, firstName, settings.reviewLink);
  const testMode = !twilioConfigured();

  const entry = {
    name: cleanName,
    phone: to,
    body,
    date: new Date().toISOString(),
    status: "sent",
    testMode,
  };

  try {
    if (!testMode) {
      entry.twilioSid = await sendSms(to, body);
    }
    history.push(entry);
    writeJson(HISTORY_FILE, history);
    res.json({ ok: true, testMode });
  } catch (err) {
    entry.status = "failed";
    entry.error = err.message;
    history.push(entry);
    writeJson(HISTORY_FILE, history);
    res.status(502).json({ error: `Send failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  const mode = twilioConfigured()
    ? "LIVE (Twilio connected)"
    : "TEST MODE (no Twilio credentials — messages are logged, not sent)";
  console.log(`Morris Pools review texts running at http://localhost:${PORT}`);
  console.log(`Mode: ${mode}`);
});
