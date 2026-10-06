function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be configured before running this script.');
  }
  return process.env.DATABASE_URL;
}

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '../../.env' });
dotenv.config();

const connectionString = requireDatabaseUrl();

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  try {
    await pool.query(`
      create table if not exists public.product_recipes (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations(id) on delete cascade,
        parent_product_id uuid not null references public.products(id) on delete cascade,
        parent_variant_id uuid references public.product_variants(id) on delete cascade,
        ingredient_product_id uuid not null references public.products(id) on delete cascade,
        ingredient_variant_id uuid references public.product_variants(id) on delete cascade,
        quantity_required numeric(14, 4) not null check (quantity_required > 0),
        unit text not null default 'piece',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (organization_id, parent_product_id, parent_variant_id, ingredient_product_id, ingredient_variant_id)
      );
    `);
    console.log('Successfully created product_recipes table in Supabase database!');
  } catch (err) {
    console.error('Error updating database:', err);
  } finally {
    await pool.end();
  }
}

main();
