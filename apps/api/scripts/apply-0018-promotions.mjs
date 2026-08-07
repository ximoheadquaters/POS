import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../../../supabase/migrations/0018_advanced_promotions.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('NO_DATABASE_URL');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
try {
  await client.query(sql);
  const tables = await client.query(`
    select to_regclass('public.promotions') as promotions,
           to_regclass('public.promotion_items') as items
  `);
  console.log(JSON.stringify({ applied: true, tables: tables.rows[0] }, null, 2));
} catch (error) {
  console.error('ERR', error.message);
  process.exit(1);
} finally {
  await client.end();
}
