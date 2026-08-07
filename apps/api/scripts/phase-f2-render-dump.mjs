import { createClient } from '@supabase/supabase-js';

const api = 'https://ximo-pos-api.onrender.com/api/v1';
const sb = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
);

async function dump(email, pass) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  const token = data.session.access_token;
  const qs = 'from=2026-07-08&to=2026-08-06';
  const paths = [
    `/reports/overview?${qs}`,
    `/reports/sales?${qs}`,
    `/reports/products?${qs}`,
    `/reports/workspace?from=2026-07-07T16:00:00.000Z&to=2026-08-06T16:00:00.000Z`,
  ];
  const out = { email };
  for (const path of paths) {
    const res = await fetch(`${api}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const key = path.split('?')[0];
    out[key] = {
      status: res.status,
      error: body.error || body.message || null,
      dataKeys: body.data ? Object.keys(body.data) : null,
      summaryCards: (body.data?.summaryCards || []).map((c) => ({
        label: c.label,
        value: c.formattedValue ?? c.value,
        sensitive: !!c.isSensitive,
      })),
      kpis: body.data?.kpis ?? null,
      firstRow: (body.data?.rows || [])[0] || null,
    };
  }
  return out;
}

const owner = await dump('owner@ximo.local', process.env.DEMO_OWNER_PASSWORD);
const cashier = await dump(
  'cashier.bacolod@ximo.local',
  process.env.DEMO_CASHIER_1_PASSWORD,
);
console.log(JSON.stringify({ owner, cashier }, null, 2));
