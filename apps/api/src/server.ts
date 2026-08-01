import { createApp } from './app.js';
import { createSupabaseAuth } from './auth/supabase.js';
import { loadConfig } from './config.js';
import { PostgresDatabase } from './database/postgres.js';
import { createSupabaseAssetStorage } from './storage/supabase-assets.js';

const config = loadConfig();
const database = new PostgresDatabase(config);
const auth = createSupabaseAuth(config);
const app = createApp({
  database,
  verifyToken: auth.verifyToken,
  authActions: auth.actions,
  assetStorage: createSupabaseAssetStorage(config),
});

const server = app.listen(config.PORT, () => {
  console.log(`Ximo POS API listening on http://localhost:${config.PORT}`);
});

async function shutdown() {
  server.close();
  await database.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
