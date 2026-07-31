import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:gamora09287310860@db.qpkodtxawlswrndvxlvc.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await pool.query(`
      insert into public.modules (code, name) values ('audit', 'Audit Logs')
      on conflict (code) do nothing;

      insert into public.plan_modules (plan_id, module_id)
      select p.id, m.id from public.plans p cross join public.modules m
      where m.code = 'audit' and p.code in ('business', 'professional', 'enterprise')
      on conflict do nothing;
    `);
    console.log('Successfully inserted audit module into Supabase database!');
  } catch (err) {
    console.error('Error updating database:', err);
  } finally {
    await pool.end();
  }
}

main();
