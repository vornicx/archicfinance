import { getSession, getBalances, getTransactions } from "./enable-banking.js";

function ymd(date) { return date.toISOString().slice(0, 10); }
function label(t) {
  const party = t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name;
  const remittance = Array.isArray(t.remittance_information) ? t.remittance_information.find(Boolean) : t.remittance_information;
  return party || remittance || t.bank_transaction_code?.description || "Movimiento";
}
function normalise(t) {
  const amount = Number(t.transaction_amount?.amount || 0);
  const isCredit = t.credit_debit_indicator === "CRDT";
  return { date: t.booking_date || t.value_date || "", amount: isCredit ? amount : -amount, currency: t.transaction_amount?.currency || "EUR", merchant: label(t) };
}
function pickBalance(data) {
  const list = data?.balances || [];
  for (const type of ["CLAV", "ITAV", "CRDT", "XPCD"]) {
    const found = list.find(b => b.balance_type === type);
    if (found) return found;
  }
  return list[0] || null;
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
  const accounts = session.accounts || session.accounts_data?.map(a => a.uid).filter(Boolean) || [];
  const allTx = [];
  const accountSummaries = [];

  for (const accountId of accounts) {
    const [balances, transactions] = await Promise.all([getBalances(accountId), getTransactions(accountId, ymd(start), ymd(end))]);
    const bal = pickBalance(balances);
    accountSummaries.push({ balance: Number(bal?.balance_amount?.amount || 0), currency: bal?.balance_amount?.currency || "EUR" });
    allTx.push(...transactions.map(normalise));
  }

  const eurAccounts = accountSummaries.filter(a => a.currency === "EUR");
  const currentBalance = eurAccounts.reduce((s, a) => s + a.balance, 0);
  const eurTx = allTx.filter(t => t.currency === "EUR");
  const income = eurTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = Math.abs(eurTx.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const netCashflow = income - expenses;
  const savingsRate = income > 0 ? (netCashflow / income) * 100 : null;
  const largestExpenses = eurTx.filter(t => t.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    period: { days, from: ymd(start), to: ymd(end) },
    currentBalance,
    currency: "EUR",
    income,
    expenses,
    netCashflow,
    savingsRate,
    transactionCount: eurTx.length,
    accountCount: accounts.length,
    consentValidUntil: session.access?.valid_until || null,
    largestExpenses
  };
}

export function summaryEmailHtml(s) {
  const f = n => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  const rows = s.largestExpenses.length ? s.largestExpenses.map(t => `<li><strong>${f(Math.abs(t.amount))}</strong> · ${escapeHtml(t.merchant)} · ${escapeHtml(t.date)}</li>`).join("") : "<li>Sin gastos contabilizados.</li>";
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:32px;color:#111"><h1>Finance Monitor</h1><p>${s.period.from} → ${s.period.to}</p><p><strong>Saldo:</strong> ${f(s.currentBalance)}<br><strong>Ingresos:</strong> ${f(s.income)}<br><strong>Gastos:</strong> ${f(s.expenses)}<br><strong>Cashflow:</strong> ${f(s.netCashflow)}<br><strong>Tasa de ahorro:</strong> ${s.savingsRate == null ? "N/D" : s.savingsRate.toFixed(1) + "%"}</p><h2>Mayores gastos</h2><ul>${rows}</ul><p style="font-size:13px;color:#777">Acceso bancario de solo lectura. No puede realizar pagos.</p></body></html>`;
}
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[ch])); }
