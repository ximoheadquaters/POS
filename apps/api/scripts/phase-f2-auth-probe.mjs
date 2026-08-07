import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const remoteApi = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const localApi = 'http://localhost:4000/api/v1';

async function probe(label, email, password, apiBase) {
  const sb = createClient(supabaseUrl, anon);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { label, apiBase: apiBase.replace(/https?:\/\/[^/]+/, '***'), login_error: error.message };
  const token = data.session.access_token;
  const from = '2026-07-07T16:00:00.000Z';
  const to = '2026-08-06T16:00:00.000Z';
  const me = await fetch(`${apiBase}/auth/current`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mej = await me.json();
  const user = mej.data || {};
  const ws = await fetch(
    `${apiBase}/reports/workspace?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const wsj = await ws.json();
  const kpis = wsj.data?.kpis || {};
  const top = (wsj.data?.sales?.topProducts || []).slice(0, 2).map((p) => ({
    name: p.name,
    sales: p.sales,
    cost: p.cost,
    profit: p.profit,
    quantity: p.quantity,
    unit: p.unit,
  }));
  const products = await fetch(
    `${apiBase}/reports/products?from=2026-07-08&to=2026-08-06`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const pj = await products.json();
  return {
    label,
    apiBase: apiBase.replace(/https?:\/\/[^/]+/, '***'),
    meStatus: me.status,
    role: user.role,
    reportPerms: (user.permissions || []).filter((p) => String(p).includes('report')),
    workspaceStatus: ws.status,
    kpis: {
      netSales: kpis.netSales ?? null,
      netCost: kpis.netCost ?? null,
      grossProfit: kpis.grossProfit ?? null,
      grossMarginPercent: kpis.grossMarginPercent ?? null,
    },
    topProducts: top,
    productsStatus: products.status,
    productCards: (pj.data?.summaryCards || []).map((c) => ({
      label: c.label,
      value: c.formattedValue ?? c.value,
      sensitive: c.isSensitive ?? false,
    })),
    productRowSample: (pj.data?.rows || []).slice(0, 3).map((r) => ({
      title: r.title,
      quantity: r.quantity,
      unit: r.unit,
      baseQuantity: r.baseQuantity,
      baseUnit: r.baseUnit,
      value: r.value,
      subValue: r.subValue,
    })),
  };
}

const ownerPassword = process.env.DEMO_OWNER_PASSWORD;
const cashierPassword = process.env.DEMO_CASHIER_1_PASSWORD;
const out = [];
out.push(await probe('owner-remote', 'owner@ximo.local', ownerPassword, remoteApi));
out.push(await probe('owner-local', 'owner@ximo.local', ownerPassword, localApi));
out.push(await probe('cashier-remote', 'cashier.bacolod@ximo.local', cashierPassword, remoteApi));
out.push(await probe('cashier-local', 'cashier.bacolod@ximo.local', cashierPassword, localApi));
console.log(JSON.stringify(out, null, 2));
