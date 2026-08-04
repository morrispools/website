require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");

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

function getQueue() {
  return readJson(QUEUE_FILE, []);
}

function getSettings() {
  const settings = readJson(SETTINGS_FILE, {});
  return {
    template: settings.template || DEFAULT_TEMPLATE,
    reviewLink: settings.reviewLink || process.env.GOOGLE_REVIEW_LINK || "",
    autoSend: settings.autoSend === true,
    cooldownDays: Number.isFinite(settings.cooldownDays)
      ? settings.cooldownDays
      : 90,
  };
}

// ---------- phone / template helpers ----------

// Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns null if invalid.
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

function renderTemplate(template, name, link) {
  return template.replaceAll("{name}", name).replaceAll("{link}", link).trim();
}

// Most recent successful send to this number, or null.
function lastSentTo(phone) {
  const sends = getHistory().filter(
    (h) => h.phone === phone && h.status === "sent"
  );
  return sends.length ? sends[sends.length - 1] : null;
}

function withinCooldown(phone, cooldownDays) {
  const last = lastSentTo(phone);
  if (!last) return false;
  const ageMs = Date.now() - new Date(last.date).getTime();
  return ageMs < cooldownDays * 24 * 60 * 60 * 1000;
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

// Shared send path for manual, queue, and auto sends. Appends to history.
// Returns the history entry.
async function performSend(name, phone, source) {
  const settings = getSettings();
  const firstName = name.split(/\s+/)[0];
  const body = renderTemplate(settings.template, firstName, settings.reviewLink);
  const testMode = !twilioConfigured();

  const entry = {
    name,
    phone,
    body,
    source: source || "manual",
    date: new Date().toISOString(),
    status: "sent",
    testMode,
  };

  const history = getHistory();
  try {
    if (!testMode) entry.twilioSid = await sendSms(phone, body);
  } catch (err) {
    entry.status = "failed";
    entry.error = err.message;
  }
  history.push(entry);
  writeJson(HISTORY_FILE, history);
  return entry;
}

// ---------- payload field extraction ----------
// Poolbrain and JobTread don't publish stable payload schemas, so these walk
// whatever JSON arrives and pull out the customer's name/phone by key shape,
// while refusing anything that belongs to a technician/employee record.

const NOT_CUSTOMER_PATH = /tech|employee|user|vendor|company|createdBy|author/i;

function walk(value, cb, pathParts = []) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, cb, pathParts);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      cb(key, child, pathParts);
      walk(child, cb, pathParts.concat(key));
    }
  }
}

function extractPhone(payload) {
  let found = null;
  walk(payload, (key, value, pathParts) => {
    if (found) return;
    if (!/phone|mobile|cell/i.test(key)) return;
    if (NOT_CUSTOMER_PATH.test(pathParts.concat(key).join("."))) return;
    if (typeof value !== "string" && typeof value !== "number") return;
    const normalized = normalizePhone(value);
    if (normalized) found = normalized;
  });
  return found;
}

const CUSTOMERISH = /customer|client|account|contact/i;

function extractName(payload) {
  let best = null;
  let bestScore = 0;
  const consider = (value, score) => {
    if (typeof value !== "string") return;
    const clean = value.trim();
    if (!clean || clean.length > 80) return;
    if (score > bestScore) {
      best = clean;
      bestScore = score;
    }
  };
  walk(payload, (key, value, pathParts) => {
    const fullPath = pathParts.concat(key).join(".");
    if (NOT_CUSTOMER_PATH.test(fullPath)) return;
    if (/^(customer|client|account|contact)[_ ]?name$/i.test(key)) {
      consider(value, 3);
    } else if (key.toLowerCase() === "name" && CUSTOMERISH.test(fullPath)) {
      consider(value, 2);
    } else if (/^first[_ ]?name$/i.test(key) && CUSTOMERISH.test(fullPath)) {
      consider(value, 2);
    }
  });
  return best;
}

function extractEventName(payload) {
  for (const key of ["event", "event_type", "eventType", "type", "topic"]) {
    const value = payload && payload[key];
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object" && typeof value.type === "string") {
      return value.type;
    }
  }
  return "";
}

function extractStatus(payload) {
  let found = null;
  walk(payload, (key, value) => {
    if (found) return;
    if (/status/i.test(key) && typeof value === "string") found = value;
  });
  return found;
}

// ---------- incoming event pipeline ----------

// Dedupe repeat webhook deliveries (both platforms are at-least-once).
const seenEvents = new Map();
function alreadySeen(rawBody) {
  const hash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const now = Date.now();
  for (const [k, t] of seenEvents) if (now - t > 60 * 60 * 1000) seenEvents.delete(k);
  if (seenEvents.has(hash)) return true;
  seenEvents.set(hash, now);
  return false;
}

async function handleIncomingClient(source, eventName, payload) {
  const settings = getSettings();
  const name = extractName(payload);
  const phone = extractPhone(payload);

  const entry = {
    id: crypto.randomUUID(),
    source,
    event: eventName || "(unknown event)",
    name: name || "",
    phone: phone || "",
    receivedAt: new Date().toISOString(),
  };

  if (phone && withinCooldown(phone, settings.cooldownDays)) {
    console.log(
      `[${source}] Skipped ${name || phone}: texted within the last ${settings.cooldownDays} days.`
    );
    return { action: "skipped_cooldown" };
  }

  if (settings.autoSend && phone && name && settings.reviewLink) {
    const sent = await performSend(name, phone, source);
    console.log(
      `[${source}] Auto-${sent.status === "sent" ? "sent" : "FAILED"} review text to ${name} (${phone}).`
    );
    if (sent.status === "sent") return { action: "sent" };
  }

  const queue = getQueue();
  const duplicate = queue.find(
    (q) => q.phone && q.phone === entry.phone && q.source === source
  );
  if (duplicate) return { action: "already_queued" };
  queue.push(entry);
  writeJson(QUEUE_FILE, queue);
  console.log(
    `[${source}] Queued for review: name=${entry.name || "?"} phone=${entry.phone || "?"} event=${entry.event}`
  );
  return { action: "queued" };
}

// ---------- webhook endpoints (before password auth: external services post here) ----------

// Poolbrain signs each request: HMAC-SHA256 of the raw body with your signing
// secret, sent in the X-Webhook-Signature header.
function poolbrainSignatureValid(rawBody, header) {
  const secret = process.env.POOLBRAIN_SIGNING_SECRET;
  if (!secret || !header) return false;
  const supplied = String(header).replace(/^sha256=/i, "").trim();
  const hmac = crypto.createHmac("sha256", secret).update(rawBody);
  const candidates = [hmac.digest("hex")];
  const hmac2 = crypto.createHmac("sha256", secret).update(rawBody);
  candidates.push(hmac2.digest("base64"));
  return candidates.some((expected) => {
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function matchesEventFilter(eventName, filterCsv) {
  const patterns = filterCsv
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!patterns.length) return true;
  if (!eventName) return true;
  return patterns.some((p) =>
    p.endsWith("*")
      ? eventName.toLowerCase().startsWith(p.slice(0, -1).toLowerCase())
      : eventName.toLowerCase() === p.toLowerCase()
  );
}

app.post(
  "/webhooks/poolbrain",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    if (!process.env.POOLBRAIN_SIGNING_SECRET) {
      return res
        .status(503)
        .json({ error: "POOLBRAIN_SIGNING_SECRET is not configured." });
    }
    const rawBody = req.body;
    if (!poolbrainSignatureValid(rawBody, req.headers["x-webhook-signature"])) {
      console.log("[poolbrain] Rejected webhook: bad or missing signature.");
      return res.status(401).json({ error: "Invalid signature." });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Body was not valid JSON." });
    }

    if (alreadySeen(rawBody)) return res.json({ received: true, action: "duplicate" });

    const eventName = extractEventName(payload);
    const filter = process.env.POOLBRAIN_EVENTS || "job.one_time.*";
    if (!matchesEventFilter(eventName, filter)) {
      return res.json({ received: true, action: "ignored_event" });
    }

    // Status-change events fire for every status; only a finished job
    // should trigger a review request.
    const status = extractStatus(payload);
    if (status && !/complet|closed|done|finish/i.test(status)) {
      return res.json({ received: true, action: "ignored_status" });
    }

    const result = await handleIncomingClient("poolbrain", eventName, payload);
    res.json({ received: true, ...result });
  }
);

// JobTread doesn't sign payloads the way Poolbrain does, so the webhook URL
// carries a shared secret: /webhooks/jobtread?key=YOUR_KEY
app.post(
  "/webhooks/jobtread",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    const expected = process.env.JOBTREAD_WEBHOOK_KEY;
    if (!expected) {
      return res
        .status(503)
        .json({ error: "JOBTREAD_WEBHOOK_KEY is not configured." });
    }
    if (req.query.key !== expected) {
      console.log("[jobtread] Rejected webhook: bad or missing ?key=");
      return res.status(401).json({ error: "Invalid key." });
    }

    const rawBody = req.body;
    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Body was not valid JSON." });
    }

    if (alreadySeen(rawBody)) return res.json({ received: true, action: "duplicate" });

    const bodyText = rawBody.toString("utf8");
    if (!/daily.?log/i.test(bodyText)) {
      return res.json({ received: true, action: "ignored_event" });
    }

    // Daily logs can be internal-only; if the payload carries a
    // customer-visibility flag and it's off, this log was never sent to the
    // client, so don't ask them for a review over it.
    let customerVisible = null;
    walk(payload, (key, value) => {
      if (typeof value !== "boolean") return;
      if (/(show|share|visible|display).*customer|customer.*(visible|facing|shared)/i.test(key)) {
        customerVisible = value;
      }
    });
    if (customerVisible === false) {
      return res.json({ received: true, action: "ignored_internal_log" });
    }

    let payloadForExtraction = payload;
    if (!extractPhone(payload) && process.env.JOBTREAD_GRANT_KEY) {
      const enriched = await jobtreadLookup(payload);
      if (enriched) payloadForExtraction = { payload, enriched };
    }

    const eventName = extractEventName(payload) || "dailyLog";
    const result = await handleIncomingClient(
      "jobtread",
      eventName,
      payloadForExtraction
    );
    res.json({ received: true, ...result });
  }
);

// Best-effort Pave API lookup: daily log -> job -> account contacts. If the
// query shape doesn't match this JobTread account's schema, we just fall back
// to the manual queue (the response is logged to help adjust it).
async function jobtreadLookup(payload) {
  let dailyLogId = null;
  walk(payload, (key, value, pathParts) => {
    if (dailyLogId) return;
    if (key === "id" && /daily.?log/i.test(pathParts.join("."))) {
      dailyLogId = String(value);
    }
  });
  if (!dailyLogId && payload.dailyLog && payload.dailyLog.id) {
    dailyLogId = String(payload.dailyLog.id);
  }
  if (!dailyLogId) return null;

  try {
    const res = await fetch("https://api.jobtread.com/pave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          $: { grantKey: process.env.JOBTREAD_GRANT_KEY },
          dailyLog: {
            $: { id: dailyLogId },
            id: {},
            job: {
              id: {},
              name: {},
              account: {
                id: {},
                name: {},
                contacts: {
                  nodes: { id: {}, name: {}, phone: {}, phoneNumber: {} },
                },
              },
            },
          },
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.log("[jobtread] Pave lookup failed:", JSON.stringify(data).slice(0, 500));
      return null;
    }
    return data;
  } catch (err) {
    console.log("[jobtread] Pave lookup error:", err.message);
    return null;
  }
}

// ---------- password auth for the UI / API ----------

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
    autoSend: settings.autoSend,
    cooldownDays: settings.cooldownDays,
    webhooks: {
      poolbrain: {
        configured: Boolean(process.env.POOLBRAIN_SIGNING_SECRET),
        path: "/webhooks/poolbrain",
      },
      jobtread: {
        configured: Boolean(process.env.JOBTREAD_WEBHOOK_KEY),
        path: "/webhooks/jobtread?key=YOUR_KEY",
      },
    },
  });
});

app.post("/api/settings", (req, res) => {
  const { template, reviewLink, autoSend, cooldownDays } = req.body || {};
  const current = readJson(SETTINGS_FILE, {});
  if (typeof template === "string" && template.trim()) {
    current.template = template.trim();
  }
  if (typeof reviewLink === "string") current.reviewLink = reviewLink.trim();
  if (typeof autoSend === "boolean") current.autoSend = autoSend;
  const days = Number(cooldownDays);
  if (Number.isFinite(days) && days >= 0 && days <= 3650) {
    current.cooldownDays = days;
  }
  writeJson(SETTINGS_FILE, current);
  res.json({ ok: true });
});

app.get("/api/history", (req, res) => {
  res.json(getHistory().slice().reverse());
});

app.get("/api/queue", (req, res) => {
  res.json(getQueue().slice().reverse());
});

app.post("/api/queue/:id/send", async (req, res) => {
  const queue = getQueue();
  const index = queue.findIndex((q) => q.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Not in the queue anymore." });

  const name = String((req.body && req.body.name) || queue[index].name || "").trim();
  const phone = normalizePhone((req.body && req.body.phone) || queue[index].phone);
  if (!name) return res.status(400).json({ error: "Client name is required." });
  if (!phone) return res.status(400).json({ error: "That phone number doesn't look valid." });
  if (!getSettings().reviewLink) {
    return res.status(400).json({
      error: "No Google review link set yet. Add it in Settings first.",
    });
  }

  const entry = await performSend(name, phone, queue[index].source);
  queue.splice(index, 1);
  writeJson(QUEUE_FILE, queue);
  if (entry.status !== "sent") {
    return res.status(502).json({ error: `Send failed: ${entry.error}` });
  }
  res.json({ ok: true, testMode: entry.testMode });
});

app.post("/api/queue/:id/dismiss", (req, res) => {
  const queue = getQueue();
  const next = queue.filter((q) => q.id !== req.params.id);
  if (next.length === queue.length) {
    return res.status(404).json({ error: "Not in the queue anymore." });
  }
  writeJson(QUEUE_FILE, next);
  res.json({ ok: true });
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

  const previous = lastSentTo(to);
  if (previous && !force) {
    return res.json({
      duplicate: true,
      previousDate: previous.date,
      previousName: previous.name,
    });
  }

  const entry = await performSend(cleanName, to, "manual");
  if (entry.status !== "sent") {
    return res.status(502).json({ error: `Send failed: ${entry.error}` });
  }
  res.json({ ok: true, testMode: entry.testMode });
});

app.listen(PORT, () => {
  const mode = twilioConfigured()
    ? "LIVE (Twilio connected)"
    : "TEST MODE (no Twilio credentials — messages are logged, not sent)";
  console.log(`Morris Pools review texts running at http://localhost:${PORT}`);
  console.log(`Mode: ${mode}`);
  console.log(
    `Webhooks: Poolbrain ${process.env.POOLBRAIN_SIGNING_SECRET ? "ready" : "off (set POOLBRAIN_SIGNING_SECRET)"}, ` +
      `JobTread ${process.env.JOBTREAD_WEBHOOK_KEY ? "ready" : "off (set JOBTREAD_WEBHOOK_KEY)"}`
  );
});
