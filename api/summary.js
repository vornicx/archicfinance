import { buildSummary } from "../lib/summary.js";

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  const url = new URL(req.url, `https://${req.headers.host}`);
  return auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export default async function handler(req, res) {
  if (!authorised(req)) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }
  try {
    const sessionId = process.env.ENABLE_BANKING_SESSION_ID;
    if (!sessionId) throw new Error("Missing ENABLE_BANKING_SESSION_ID");
    const summary = await buildSummary(sessionId, 30);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(summary, null, 2));
  } catch (error) {
    res.statusCode = error.code === "REAUTHORIZE" ? 409 : 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message, code: error.code || null }, null, 2));
  }
}
