import { getSession, getTransactions } from "./enable-banking.js";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function remittance(t) {
  if (Array.isArray(t.remittance_information)) {
    return clean(t.remittance_information.filter(Boolean).join(" · "));
  }
  return clean(t.remittance_information);
}

function counterparty(t) {
  const party = t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name;
  return clean(party) || remittance(t) || clean(t.bank_transaction_code?.description) || "Movimiento";
}

function uniqueAccounts(session) {
  const source = Array.isArray(session.accounts_data) && session.accounts_data.length
    ? session.accounts_data
    : (session.accounts || []).map(account => typeof account === "string" ? { uid: account } : account);

  const seen = new Set();
  const out = [];
  for (const account of source) {
    if (!account?.uid) continue;
    const hashes = Array.isArray(account.identification_hashes)
      ? account.identification_hashes.filter(Boolean)
      : [];
    const key = account.identification_hash || hashes[0] || account.uid;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uid: account.uid, dedupeKey: key });
  }
  return out;
}

function normalise(t) {
  const rawAmount = Number(t.transaction_amount?.amount || 0);
  const isCredit = t.credit_debit_indicator === "CRDT";
  const merchant = counterparty(t);
  const description = remittance(t) || clean(t.note) || clean(t.bank_transaction_code?.description) || merchant;

  return {
    date: t.booking_date || t.value_date || t.transaction_date || "",
    transactionDate: t.transaction_date || null,
    amount: isCredit ? rawAmount : -rawAmount,
    currency: t.transaction_amount?.currency || "EUR",
    direction: isCredit ? "income" : "expense",
    merchant,
    description,
    mcc: clean(t.merchant_category_code) || null,
    bankCode: clean(t.bank_transaction_code?.description) || null,
    entryReference: clean(t.entry_reference) || null
  };
}

function transactionKey(t) {
  const base = [t.date, t.amount, t.currency, lower(t.merchant), lower(t.description)].join("|");
  return t.entryReference ? `ref:${t.entryReference}|${base}` : `fallback:${base}`;
}

function dedupeTransactions(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = transactionKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function textFor(t) {
  return lower([t.merchant, t.description, t.bankCode].filter(Boolean).join(" "));
}

function includesAny(text, terms) {
  return terms.some(term => text.includes(term));
}

function isMccBetween(mcc, min, max) {
  const n = Number(mcc);
  return Number.isFinite(n) && n >= min && n <= max;
}

function categorise(t) {
  const text = textFor(t);
  const mcc = t.mcc;

  if (includesAny(text, [
    "flexible cash fund", "flexible cash funds", "to savings", "from savings",
    "to pocket", "from pocket", "to vault", "from vault", "internal transfer"
  ])) {
    return { category: "Transferencia interna", confidence: "high", internalTransfer: true };
  }

  if (t.direction === "income") {
    if (includesAny(text, ["nomina", "nómina", "payroll", "salary", "lasarte"])) {
      return { category: "Nómina", confidence: "high", internalTransfer: false };
    }
    if (includesAny(text, ["refund", "reembolso", "reversal", "devolucion", "devolución"])) {
      return { category: "Reembolsos", confidence: "medium", internalTransfer: false };
    }
    return { category: "Otros ingresos", confidence: "low", internalTransfer: false };
  }

  if (["5541", "5542"].includes(mcc) || includesAny(text, [
    "repsol", "cepsa", "moeve", "bp ", "shell", "galp", "petroprix", "plenergy",
    "ballenoil", "gasolinera", "fuel", "combustible"
  ])) {
    return { category: "Combustible", confidence: "high", internalTransfer: false };
  }

  if (mcc === "4511" || isMccBetween(mcc, 3000, 3299) || includesAny(text, [
    "vueling", "ryanair", "easyjet", "iberia", "air europa", "volotea", "binter", "canaryfly"
  ])) {
    return { category: "Vuelos", confidence: "high", internalTransfer: false };
  }

  if (mcc === "7011" || includesAny(text, ["airbnb", "booking.com", "hotel", "hostel", "apartamento"])) {
    return { category: "Alojamiento", confidence: "high", internalTransfer: false };
  }

  if (["4121", "7523", "4784"].includes(mcc) || includesAny(text, [
    "uber", "cabify", "taxi", "renfe", "iryo", "parking", "aparcamiento", "peaje", "metro"
  ])) {
    return { category: "Transporte", confidence: "high", internalTransfer: false };
  }

  if (["5812", "5813", "5814"].includes(mcc) || includesAny(text, [
    "restaurant", "restaurante", "burger", "mcdonald", "kfc", "starbucks", "cafe", "café", "bar "
  ])) {
    return { category: "Restaurantes y cafés", confidence: mcc ? "high" : "medium", internalTransfer: false };
  }

  if (mcc === "5411" || includesAny(text, [
    "mercadona", "carrefour", "lidl", "aldi", "dia ", "supermercado", "coviran", "covirán"
  ])) {
    return { category: "Supermercado", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, [
    "openai", "chatgpt", "anthropic", "claude", "cursor", "vercel", "railway", "github",
    "ionos", "google one", "google workspace", "apple.com/bill", "qwen", "x.ai", "grok"
  ])) {
    return { category: "Software y suscripciones", confidence: "high", internalTransfer: false };
  }

  if (["5912", "8011", "8062", "8099"].includes(mcc) || includesAny(text, [
    "farmacia", "pharmacy", "hospital", "clinica", "clínica", "dentista"
  ])) {
    return { category: "Salud", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["gimnasio", "gym", "fitness"])) {
    return { category: "Deporte", confidence: "medium", internalTransfer: false };
  }

  if (includesAny(text, ["amazon", "zara", "pull&bear", "bershka", "stradivarius", "primark", "ikea"])) {
    return { category: "Compras", confidence: "medium", internalTransfer: false };
  }

  if (includesAny(text, ["atm", "cajero", "cash withdrawal", "retirada de efectivo"])) {
    return { category: "Efectivo", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["transfer", "transferencia", "p2p", "card to card"])) {
    return { category: "Transferencias a terceros", confidence: "medium", internalTransfer: false };
  }

  return { category: "Sin clasificar", confidence: "low", internalTransfer: false };
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export async function buildLedger(sessionId, from, to) {
  const session = await getSession(sessionId);
  if (session.status !== "AUTHORIZED") {
    const err = new Error(`Bank session is ${session.status || "not authorized"}`);
    err.code = "REAUTHORIZE";
    throw err;
  }

  const accounts = uniqueAccounts(session);
  const rawTransactions = [];

  for (const account of accounts) {
    const transactions = await getTransactions(account.uid, from, to);
    rawTransactions.push(...transactions.map(normalise));
  }

  const unique = dedupeTransactions(rawTransactions)
    .filter(t => t.currency === "EUR")
    .map(t => {
      const classification = categorise(t);
      const { entryReference, ...safe } = t;
      return { ...safe, ...classification };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Math.abs(b.amount) - Math.abs(a.amount));

  const external = unique.filter(t => !t.internalTransfer);
  const expenses = external.filter(t => t.amount < 0);
  const income = external.filter(t => t.amount > 0);
  const internal = unique.filter(t => t.internalTransfer);

  const byCategory = new Map();
  for (const t of expenses) {
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + Math.abs(t.amount));
  }

  const categoryTotals = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const byMerchant = new Map();
  for (const t of expenses) {
    const key = t.merchant || "Movimiento";
    const current = byMerchant.get(key) || { merchant: key, amount: 0, count: 0, category: t.category };
    current.amount += Math.abs(t.amount);
    current.count += 1;
    byMerchant.set(key, current);
  }

  const topMerchants = [...byMerchant.values()]
    .map(x => ({ ...x, amount: round(x.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    period: { from, to },
    currency: "EUR",
    totals: {
      income: round(income.reduce((s, t) => s + t.amount, 0)),
      expenses: round(Math.abs(expenses.reduce((s, t) => s + t.amount, 0))),
      netCashflow: round(external.reduce((s, t) => s + t.amount, 0)),
      transactionCount: external.length,
      internalTransferCount: internal.length,
      internalTransferNet: round(internal.reduce((s, t) => s + t.amount, 0)),
      uniqueAccountCount: accounts.length,
      rawTransactionCount: rawTransactions.length,
      deduplicatedTransactionCount: unique.length
    },
    categoryTotals,
    topMerchants,
    transactions: unique,
    consentValidUntil: session.access?.valid_until || null
  };
}
