import { authorizeSession } from "../lib/enable-banking.js";

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    res.statusCode = 400;
    res.end(`Authorization cancelled: ${error}`);
    return;
  }
  if (!code) {
    res.statusCode = 400;
    res.end("Missing authorization code.");
    return;
  }
  try {
    const session = await authorizeSession(code);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="es"><body style="font-family:system-ui;max-width:720px;margin:60px auto;padding:0 20px"><h1>Revolut conectado</h1><p>Guarda este valor en Vercel como <code>ENABLE_BANKING_SESSION_ID</code>:</p><pre style="padding:16px;background:#f4f4f4;word-break:break-all;white-space:pre-wrap">${session.session_id}</pre><p>Luego haz redeploy.</p></body></html>`);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message }, null, 2));
  }
}
