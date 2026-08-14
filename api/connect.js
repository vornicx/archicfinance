import { startRevolutAuth } from "../lib/enable-banking.js";

export default async function handler(req, res) {
  try {
    const auth = await startRevolutAuth();
    res.statusCode = 302;
    res.setHeader("Location", auth.url);
    res.end();
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message }, null, 2));
  }
}
