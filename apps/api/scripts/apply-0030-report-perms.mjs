import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../../../supabase/migrations/0030_report_capability_permissions.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('NO_DATABASE_URL');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  const perms = await client.query(
    `select code from permissions where code like 'reports:%' order by code`,
  );
  const owner = await client.query(
    `select p.code
     from role_permissions rp
     join roles r on r.id = rp.role_id
     join permissions p on p.id = rp.permission_id
     where r.code = 'owner' and p.code like 'reports:%'
     order by p.code`,
  );
  const cashier = await client.query(
    `select p.code
     from role_permissions rp
     join roles r on r.id = rp.role_id
     join permissions p on p.id = rp.permission_id
     where r.code = 'cashier' and p.code like 'reports:%'
     order by p.code`,
  );
  await client.query('COMMIT');
  console.log(
    JSON.stringify(
      {
        reportPerms: perms.rows.map((r) => r.code),
        ownerReportPerms: owner.rows.map((r) => r.code),
        cashierReportPerms: cashier.rows.map((r) => r.code),
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query('ROLLBACK');
  console.error('ERR', error.message);
  process.exit(1);
} finally {
  await client.end();
}
