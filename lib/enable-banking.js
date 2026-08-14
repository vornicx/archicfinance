import crypto from "node:crypto";

const API = "https://api.enablebanking.com";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKey() {
  return env("ENABLE_BANKING_PRIVATE_KEY").replace(/\\n/g, "\n");
}

export function makeJwt() {
  const appId = env("ENABLE_BANKING_APP_ID");
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: appId };
  const payload = { iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 15 * 60 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey());
  return `${unsigned}.${b64url(signature)}`;
}

export async function ebFetch(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${makeJwt()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: text }; }

  if (!res.ok) throw new Error(`Enable Banking ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function getRevolutMeta() {
  const data = await ebFetch("/aspsps?country=ES&psu_type=personal&service=AIS");
  const all = data.aspsps || [];
  return all.find(x => (x.name || "").toLowerCase() === "revolut") || all.find(x => (x.name || "").toLowerCase().includes("revolut"));
}

export async function startRevolutAuth() {
  const appUrl = env("APP_URL");
  const revolut = await getRevolutMeta();
  if (!revolut) throw new Error("Revolut was not returned by Enable Banking for ES/personal/AIS.");

  const maxSeconds = Number(revolut.maximum_consent_validity || 180 * 24 * 60 * 60);
  const validityMs = Math.max(24 * 60 * 60 * 1000, (maxSeconds - 3600) * 1000);
  const validUntil = new Date(Date.now() + validityMs).toISOString();

  return ebFetch("/auth", {
    method: "POST",
    body: JSON.stringify({
      access: { valid_until: validUntil, balances: true, transactions: true },
      aspsp: { name: revolut.name, country: "ES" },
      state: crypto.randomUUID(),
      redirect_url: `${appUrl}/api/callback`,
      psu_type: "personal",
      language: "es",
      psu_id: "personal-finance-monitor"
    })
  });
}

export async function authorizeSession(code) {
  return ebFetch("/sessions", { method: "POST", body: JSON.stringify({ code }) });
}

export async function getSession(sessionId) {
  return ebFetch(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function getBalances(accountId) {
  return ebFetch(`/accounts/${encodeURIComponent(accountId)}/balances`);
}

export async function getTransactions(accountId, dateFrom, dateTo) {
  const out = [];
  let continuationKey = null;
  do {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, transaction_status: "BOOK" });
    if (continuationKey) params.set("continuation_key", continuationKey);
    const page = await ebFetch(`/accounts/${encodeURIComponent(accountId)}/transactions?${params.toString()}`);
    out.push(...(page.transactions || []));
    continuationKey = page.continuation_key || null;
  } while (continuationKey);
  return out;
}
