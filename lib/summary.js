import { getSession, getBalances, getTransactions } from "./enable-banking.js";

function ymd(date) { return date.toISOString().slice(0, 10); }

function label(t) {
  const party = t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name;
  const remittance = Array.isArray(t.remittance_information)
    ? t.remittance_information.find(Boolean)
    : t.remittance_information;
  return party || remittance || t.bank_transaction_code?.description || "Movimiento";
}

function normalise(t) {
  const amount = Number(t.transaction_amount?.amount || 0);
  const isCredit = t.credit_debit_indicator === "CRDT";
  return {
    date: t.booking_date || t.value_date || "",
    amount: isCredit ? amount : -amount,
    currency: t.transaction_amount?.currency || "EUR",
    merchant: label(t),
    entryReference: t.entry_reference || null
  };
}

function pickBalance(data) {
  const list = data?.balances || [];
  for (const type of ["CLAV", "ITAV", "CRDT", "XPCD"]) {
    const found = list.find(b => b.balance_type === type);
    if (found) return found;
  }
  return list[0] || null;
}

function uniqueAccounts(session) {
  const data = Array.isArray(session.accounts_data) && session.accounts_data.length
    ? session.accounts_data
    : (session.accounts || []).map(uid => ({ uid }));

  const seen = new Set();
  const unique = [];
  for (const account of data) {
    const hashes = Array.isArray(account.identification_hashes) ? account.identification_hashes.filter(Boolean) : [];
    const key = account.identification_hash || hashes[0] || account.uid;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(account);
  }
  return unique;
}

function dedupeTransactions(items) {
  const seen = new Set();
  const out = [];
  for (const t of items) {
    const fallback = `${t.date}|${t.amount}|${t.currency}|${String(t.merchant).toLowerCase()}`;
    const key = t.entryReference ? `ref:${t.entryReference}` : `fallback:${fallback}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function isInternalTransfer(t) {
  const text = String(t.merchant || "").toLowerCase();
  return [
    "flexible cash funds",
    "flexible cash fund",
    "to savings",
    "from savings",
    "to pocket",
    "from pocket"
  ].some(term => text.includes(term));
}

export async function buildSummary(sessionId, days = 30) {
  const session = await getSession(sessionId);
  if (session.status !== "AUTHORIZED") {
    const err = new Error(`Bank session is ${session.status || "not authorized"}`);
    err.code = "REAUTHORIZE";
    throw err;
  }

  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days + 1);

  const accounts = uniqueAccounts(session);
  const allTx = [];
  const accountSummaries = [];

  for (const account of accounts) {
    const accountId = account.uid;
    const [balances, transactions] = await Promise.all([
      getBalances(accountId),
      getTransactions(accountId, ymd(start), ymd(end))
    ]);
    const bal = pickBalance(balances);
    accountSummaries.push({
      balance: Number(bal?.balance_amount?.amount || 0),
      currency: bal?.balance_amount?.currency || "EUR"
    });
    allTx.push(...transactions.map(normalise));
  }

  const eurAccounts = accountSummaries.filter(a => a.currency === "EUR");
  const currentBalance = eurAccounts.reduce((s, a) => s + a.balance, 0);
  const eurTx = dedupeTransactions(allTx.filter(t => t.currency === "EUR"));
  const externalTx = eurTx.filter(t => !isInternalTransfer(t));
  const internalTransfers = eurTx.filter(isInternalTransfer);

  const income = externalTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = Math.abs(externalTx.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const netCashflow = income - expenses;
  const savingsRate = income > 0 ? (netCashflow / income) * 100 : null;
  const largestExpenses = externalTx
    .filter(t => t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 8)
    .map(({ entryReference, ...t }) => t);

  return {
    generatedAt: new Date().toISOString(),
    period: { days, from: ymd(start), to: ymd(end) },
    currentBankBalance: currentBalance,
    balanceNote: "Saldo de cuentas bancarias expuesto por Open Banking; productos de inversión o Flexible Cash Funds pueden no estar incluidos.",
    currency: "EUR",
    income,
    expenses,
    netCashflow,
    savingsRate,
    transactionCount: externalTx.length,
    internalTransferCount: internalTransfers.length,
    internalTransferNet: internalTransfers.reduce((s, t) => s + t.amount, 0),
    accountCount: accounts.length,
    rawLinkedAccountCount: (session.accounts || []).length,
    consentValidUntil: session.access?.valid_until || null,
    largestExpenses
  };
}
