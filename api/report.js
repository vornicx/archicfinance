import { buildSummary, summaryEmailHtml } from "../lib/summary.js";
import { sendReport } from "../lib/resend.js";

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
    const subject = `[Finance Weekly] ${summary.currentBalance.toFixed(2)} EUR · ${summary.period.to}`;
    const email = await sendReport({
      subject,
      html: summaryEmailHtml(summary),
      text: `FINANCE_MONITOR_JSON\n${JSON.stringify(summary)}`
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, emailId: email.id, summary }, null, 2));
  } catch (error) {
    if (error.code === "REAUTHORIZE") {
      try {
        await sendReport({
          subject: "[Finance Weekly] Revolut necesita volver a autorizarse",
          html: `<p>La sesión de Revolut ha caducado o dejado de estar autorizada.</p><p>Abre <strong>${process.env.APP_URL}/api/connect</strong> y vuelve a autorizar el acceso.</p>`,
          text: `Vuelve a autorizar Revolut en ${process.env.APP_URL}/api/connect`
        });
      } catch {}
    }
    res.statusCode = error.code === "REAUTHORIZE" ? 409 : 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message, code: error.code || null }, null, 2));
  }
}
