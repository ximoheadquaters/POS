import pkg from '../apps/api/node_modules/pg/lib/index.js';
const { Pool } = pkg;

async function checkLocalDb() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
  });
  try {
    const client = await pool.connect();
    console.log('Connected to local postgres on 5432!');
    const res = await client.query('SELECT 1 as connected');
    console.log(res.rows);
    client.release();
  } catch (err) {
    console.log('5432 failed:', err.message);
  } finally {
    await pool.end();
  }
}

checkLocalDb();
