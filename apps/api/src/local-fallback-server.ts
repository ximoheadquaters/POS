import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { createApp } from './app.js';
import { createLocalFallbackAuth } from './auth/local-fallback.js';
import { PostgresDatabase } from './database/postgres.js';

loadDotenv({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

const loopbackHost = '127.0.0.1';
const loopbackPort = 4000;

const localFallbackConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).default('true'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(4).default(2),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  EXPO_PUBLIC_SUPABASE_URL: z.url().optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

function loadLocalFallbackConfig(source: NodeJS.ProcessEnv = process.env) {
  const result = localFallbackConfigSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid local fallback API configuration:\n${issues}`);
  }

  const publicSupabaseUrl = result.data.SUPABASE_URL ?? result.data.EXPO_PUBLIC_SUPABASE_URL;
  const publicSupabaseAnonKey =
    result.data.SUPABASE_ANON_KEY ?? result.data.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!publicSupabaseUrl || !publicSupabaseAnonKey) {
    throw new Error(
      'Invalid local fallback API configuration:\n- SUPABASE_URL and SUPABASE_ANON_KEY are required',
    );
  }

  return {
    DATABASE_URL: result.data.DATABASE_URL,
    DATABASE_SSL: result.data.DATABASE_SSL,
    DATABASE_POOL_MAX: result.data.DATABASE_POOL_MAX,
    SUPABASE_URL: publicSupabaseUrl,
    SUPABASE_ANON_KEY: publicSupabaseAnonKey,
  };
}

const config = loadLocalFallbackConfig();
const database = new PostgresDatabase(config);
const auth = createLocalFallbackAuth(config);
const app = createApp({
  database,
  verifyToken: auth.verifyToken,
  authActions: auth.actions,
  disabledRoutes: ['admin', 'platform'],
});

const server = app.listen(loopbackPort, loopbackHost, () => {
  console.log(`Ximo POS local fallback API listening on http://${loopbackHost}:${loopbackPort}`);
});

async function shutdown() {
  server.close();
  await database.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
