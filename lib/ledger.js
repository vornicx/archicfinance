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
    out.push({ uid: account.uid });
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
    status: clean(t.status) || "BOOK",
    merchant,
    description,
    mcc: clean(t.merchant_category_code) || null,
    bankCode: clean(t.bank_transaction_code?.description) || null,
    entryReference: clean(t.entry_reference) || null
  };
}

function transactionKey(t) {
  const base = [t.status, t.date, t.amount, t.currency, lower(t.merchant), lower(t.description)].join("|");
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

  if (t.direction === "income" && includesAny(text, ["vadim vornic", "envio de dinero - imaginbank"])) {
    return { category: "Transferencia interna", confidence: "high", internalTransfer: true };
  }

  if (t.direction === "income") {
    if (includesAny(text, ["nomina", "nómina", "payroll", "salary", "lasarte"])) {
      return { category: "Nómina", confidence: "high", internalTransfer: false };
    }
    if (includesAny(text, ["bizum payment from", "payment from paypal", "refund", "reembolso", "reversal", "devolucion", "devolución"])) {
      return { category: "Reembolsos y Bizum recibidos", confidence: "medium", internalTransfer: false };
    }
    return { category: "Otros ingresos", confidence: "low", internalTransfer: false };
  }

  if (["5541", "5542"].includes(mcc) || includesAny(text, [
    "repsol waylet", "cepsa", "moeve", "bp ", "shell", "galp", "petroprix", "plenergy",
    "ballenoil", "gasolinera", "fuel", "combustible"
  ])) {
    return { category: "Combustible", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["lavadero repsol", "car wash", "lavadero"])) {
    return { category: "Coche y mantenimiento", confidence: "high", internalTransfer: false };
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
    "restaurant", "restaurante", "burger", "mcdonald", "kfc", "starbucks", "cafe", "café", "bar ",
    "meson", "mesón", "golosinas"
  ])) {
    return { category: "Restaurantes y cafés", confidence: mcc ? "high" : "medium", internalTransfer: false };
  }

  if (mcc === "5411" || includesAny(text, [
    "mercadona", "carrefour", "carref", "lidl", "aldi", "dia ", "supermercado", "sup. ", "sup ",
    "coviran", "covirán", "tienda david y carmen"
  ])) {
    return { category: "Supermercado", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, [
    "openai", "chatgpt", "anthropic", "claude", "cursor", "vercel", "railway", "github",
    "ionos", "google one", "google workspace", "apple.com/bill", "qwen", "x.ai", "grok"
  ])) {
    return { category: "Software y suscripciones", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["simyo", "vodafone", "orange", "movistar", "telefonica", "telefónica", "digi", "lowi"])) {
    return { category: "Telefonía", confidence: "high", internalTransfer: false };
  }

  if (["5912", "8011", "8062", "8099"].includes(mcc) || includesAny(text, [
    "farmacia", "pharmacy", "hospital", "clinica", "clínica", "dentista", "soloptical", "optica", "óptica"
  ])) {
    return { category: "Salud", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["gimnasio", "gym", "fitness"])) {
    return { category: "Deporte", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["bet365", "once", "lottery", "loteria", "lotería", "apuestas"])) {
    return { category: "Juego y apuestas", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["greenpeace", "donacion", "donación", "charity"])) {
    return { category: "Donaciones", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["cine", "cinema", "spotify", "netflix", "hbo", "disney+"])) {
    return { category: "Ocio", confidence: "medium", internalTransfer: false };
  }

  if (includesAny(text, [
    "amazon", "zara", "pull&bear", "bershka", "stradivarius", "primark", "ikea", "joyeria", "joyería",
    "primor", "retail group"
  ])) {
    return { category: "Compras", confidence: "medium", internalTransfer: false };
  }

  if (includesAny(text, ["atm", "cajero", "cash withdrawal", "retirada de efectivo"])) {
    return { category: "Efectivo", confidence: "high", internalTransfer: false };
  }

  if (includesAny(text, ["bizum payment to", "transfer", "transferencia", "p2p", "card to card"])) {
    return { category: "Transferencias y Bizum", confidence: "high", internalTransfer: false };
  }

  return { category: "Sin clasificar", confidence: "low", internalTransfer: false };
}

function dedupeInternalTransfers(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item.internalTransfer) return true;
    const key = [item.status, item.date, item.amount, lower(item.merchant), lower(item.description)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function aggregateCategories(items) {
  const byCategory = new Map();
  for (const t of items.filter(t => t.amount < 0 && !t.internalTransfer)) {
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + Math.abs(t.amount));
  }
  return [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);
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
    const transactions = await getTransactions(account.uid, from, to, null);
    rawTransactions.push(...transactions.map(normalise));
  }

  const relevant = dedupeTransactions(rawTransactions)
    .filter(t => t.currency === "EUR" && ["BOOK", "HOLD", "PDNG"].includes(t.status))
    .map(t => ({ ...t, ...categorise(t) }));

  const unique = dedupeInternalTransfers(relevant)
    .map(({ entryReference, ...safe }) => ({ ...safe, pending: safe.status !== "BOOK" }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(a.pending) - Number(b.pending) || Math.abs(b.amount) - Math.abs(a.amount));

  const booked = unique.filter(t => t.status === "BOOK");
  const pending = unique.filter(t => t.status !== "BOOK");
  const bookedExternal = booked.filter(t => !t.internalTransfer);
  const pendingExternal = pending.filter(t => !t.internalTransfer);
  const bookedExpenses = bookedExternal.filter(t => t.amount < 0);
  const bookedIncome = bookedExternal.filter(t => t.amount > 0);
  const pendingExpenses = pendingExternal.filter(t => t.amount < 0);
  const pendingIncome = pendingExternal.filter(t => t.amount > 0);
  const internal = unique.filter(t => t.internalTransfer);

  const byMerchant = new Map();
  for (const t of bookedExpenses) {
    const key = t.merchant || "Movimiento";
    const current = byMerchant.get(key) || { merchant: key, amount: 0, count: 0, category: t.category };
    current.amount += Math.abs(t.amount);
    current.count += 1;
    byMerchant.set(key, current);
  }

  const topMerchants = [...byMerchant.values()]
    .map(x => ({ ...x, amount: round(x.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 25);

  const salaryIncome = bookedIncome.filter(t => t.category === "Nómina").reduce((s, t) => s + t.amount, 0);
  const reimbursementIncome = bookedIncome.filter(t => t.category === "Reembolsos y Bizum recibidos").reduce((s, t) => s + t.amount, 0);

  return {
    generatedAt: new Date().toISOString(),
    period: { from, to },
    currency: "EUR",
    totals: {
      income: round(bookedIncome.reduce((s, t) => s + t.amount, 0)),
      salaryIncome: round(salaryIncome),
      reimbursementIncome: round(reimbursementIncome),
      expenses: round(Math.abs(bookedExpenses.reduce((s, t) => s + t.amount, 0))),
      netCashflow: round(bookedExternal.reduce((s, t) => s + t.amount, 0)),
      pendingExpenses: round(Math.abs(pendingExpenses.reduce((s, t) => s + t.amount, 0))),
      pendingIncome: round(pendingIncome.reduce((s, t) => s + t.amount, 0)),
      bookedTransactionCount: bookedExternal.length,
      pendingTransactionCount: pendingExternal.length,
      internalTransferCount: internal.length,
      internalTransferNet: round(internal.reduce((s, t) => s + t.amount, 0)),
      uniqueAccountCount: accounts.length,
      rawTransactionCount: rawTransactions.length,
      visibleTransactionCount: unique.length
    },
    categoryTotals: aggregateCategories(booked),
    pendingCategoryTotals: aggregateCategories(pending),
    topMerchants,
    transactions: unique,
    consentValidUntil: session.access?.valid_until || null
  };
}
