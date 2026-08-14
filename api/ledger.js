import { buildLedger } from "../lib/ledger.js";

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  const url = new URL(req.url, `https://${req.headers.host}`);
  return auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function lastDayOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function resolvePeriod(url) {
  const month = url.searchParams.get("month") || currentMonth();
  const explicitFrom = url.searchParams.get("from");
  const explicitTo = url.searchParams.get("to");

  if (explicitFrom || explicitTo) {
    if (!isDate(explicitFrom) || !isDate(explicitTo)) {
      throw new Error("Use from=YYYY-MM-DD and to=YYYY-MM-DD together.");
    }
    if (explicitFrom > explicitTo) throw new Error("from must be on or before to.");
    const span = (Date.parse(`${explicitTo}T00:00:00Z`) - Date.parse(`${explicitFrom}T00:00:00Z`)) / 86400000;
    if (span > 120) throw new Error("Maximum ledger period is 120 days.");
    return { from: explicitFrom, to: explicitTo };
  }

  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Use month=YYYY-MM.");
  const from = `${month}-01`;
  const to = lastDayOfMonth(month);
  if (!isDate(from) || !isDate(to)) throw new Error("Invalid month.");
  return { from, to };
}

function privateHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export default async function handler(req, res) {
  privateHeaders(res);

  if (!authorised(req)) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }

  try {
    const sessionId = process.env.ENABLE_BANKING_SESSION_ID;
    if (!sessionId) throw new Error("Missing ENABLE_BANKING_SESSION_ID");

    const url = new URL(req.url, `https://${req.headers.host}`);
    const { from, to } = resolvePeriod(url);
    const ledger = await buildLedger(sessionId, from, to);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(ledger, null, 2));
  } catch (error) {
    res.statusCode = error.code === "REAUTHORIZE" ? 409 : 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message, code: error.code || null }, null, 2));
  }
}
