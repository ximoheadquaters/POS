import { createClient } from '@supabase/supabase-js';

const api = 'https://ximo-pos-api.onrender.com/api/v1';
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const ownerPass = process.env.DEMO_OWNER_PASSWORD;
const cashierPass = process.env.DEMO_CASHIER_1_PASSWORD;
const from = '2026-07-08';
const to = '2026-08-06';
const qs = `from=${from}&to=${to}`;

async function login(email, password) {
  const sb = createClient(supabaseUrl, anon);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session.access_token;
}

async function get(path, token) {
  const res = await fetch(`${api}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

function cardValue(cards, labelIncludes) {
  const card = (cards || []).find((c) =>
    String(c.label || '')
      .toLowerCase()
      .includes(labelIncludes),
  );
  return card ? (card.formattedValue ?? card.value ?? null) : null;
}

function summarize(role, overview, sales, products) {
  const oCards = overview.body?.data?.summaryCards || [];
  const sCards = sales.body?.data?.summaryCards || [];
  const pCards = products.body?.data?.summaryCards || [];
  const row = (products.body?.data?.rows || [])[0] || {};
  return {
    role,
    overview: overview.status,
    sales: sales.status,
    products: products.status,
    overviewCost: cardValue(oCards, 'cost of goods'),
    overviewProfit: cardValue(oCards, 'gross profit'),
    salesCost: cardValue(sCards, 'cost of goods'),
    salesProfit: cardValue(sCards, 'gross profit'),
    productRowCost: row.netCost ?? row.cost ?? null,
    productRowProfit: row.grossProfit ?? row.profit ?? null,
    productSensitiveCards: pCards
      .filter((c) => c.isSensitive)
      .map((c) => ({ label: c.label, value: c.formattedValue ?? c.value })),
    salesSensitiveCards: sCards
      .filter((c) => c.isSensitive)
      .map((c) => ({ label: c.label, value: c.formattedValue ?? c.value })),
    errors500: [overview, sales, products]
      .filter((r) => r.status >= 500)
      .map((r) => r.status),
  };
}

function deployLooksReady(ownerSum, cashierSum) {
  if ([ownerSum, cashierSum].some((s) => s.errors500.length)) return false;
  const statuses = [
    ownerSum.overview,
    ownerSum.sales,
    ownerSum.products,
    cashierSum.overview,
    cashierSum.sales,
    cashierSum.products,
  ];
  if (statuses.some((s) => s !== 200)) return false;
  const ownerHas =
    ownerSum.overviewCost != null &&
    ownerSum.overviewProfit != null &&
    ownerSum.salesCost != null &&
    ownerSum.salesProfit != null &&
    ownerSum.productRowCost != null;
  const cashierClean =
    cashierSum.overviewCost == null &&
    cashierSum.overviewProfit == null &&
    cashierSum.salesCost == null &&
    cashierSum.salesProfit == null &&
    cashierSum.productRowCost == null &&
    cashierSum.productRowProfit == null &&
    cashierSum.productSensitiveCards.length === 0 &&
    cashierSum.salesSensitiveCards.length === 0;
  return ownerHas && cashierClean;
}

const started = Date.now();
const maxMs = 12 * 60 * 1000;
let attempt = 0;
let last = null;

while (Date.now() - started < maxMs) {
  attempt += 1;
  try {
    const ownerToken = await login('owner@ximo.local', ownerPass);
    const cashierToken = await login('cashier.bacolod@ximo.local', cashierPass);
    const [oO, oS, oP, cO, cS, cP] = await Promise.all([
      get(`/reports/overview?${qs}`, ownerToken),
      get(`/reports/sales?${qs}`, ownerToken),
      get(`/reports/products?${qs}`, ownerToken),
      get(`/reports/overview?${qs}`, cashierToken),
      get(`/reports/sales?${qs}`, cashierToken),
      get(`/reports/products?${qs}`, cashierToken),
    ]);
    const ownerSum = summarize('owner', oO, oS, oP);
    const cashierSum = summarize('cashier', cO, cS, cP);
    last = {
      attempt,
      elapsedSec: Math.round((Date.now() - started) / 1000),
      owner: ownerSum,
      cashier: cashierSum,
    };
    console.log(
      JSON.stringify({
        attempt,
        elapsedSec: last.elapsedSec,
        ownerStatuses: [ownerSum.overview, ownerSum.sales, ownerSum.products],
        cashierStatuses: [cashierSum.overview, cashierSum.sales, cashierSum.products],
        ownerCost: ownerSum.overviewCost,
        ownerProfit: ownerSum.overviewProfit,
        cashierCost: cashierSum.overviewCost,
        cashierProfit: cashierSum.overviewProfit,
        ready: deployLooksReady(ownerSum, cashierSum),
      }),
    );
    if (deployLooksReady(ownerSum, cashierSum)) {
      console.log('DEPLOY_READY');
      console.log(JSON.stringify(last, null, 2));
      process.exit(0);
    }
  } catch (error) {
    console.log(JSON.stringify({ attempt, error: error.message }));
  }
  await new Promise((r) => setTimeout(r, 30000));
}

console.log('DEPLOY_TIMEOUT');
console.log(JSON.stringify(last, null, 2));
process.exit(2);
