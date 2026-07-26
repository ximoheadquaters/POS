import { z } from 'zod';
import { loadConfig } from '../config.js';
import { PostgresDatabase } from '../database/postgres.js';
import { createPlatformToken } from '../platform/token.js';

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  expiresDays: z.coerce.number().int().positive().max(3650).optional(),
  readOnly: z.boolean(),
});

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const input = inputSchema.parse({
  name: argument('--name'),
  expiresDays: argument('--expires-days'),
  readOnly: process.argv.includes('--read-only'),
});

const config = loadConfig();
const database = new PostgresDatabase(config);

try {
  const generated = createPlatformToken();
  const scopes = input.readOnly ? ['platform:read'] : ['platform:read', 'platform:write'];
  const expiresAt = input.expiresDays
    ? new Date(Date.now() + input.expiresDays * 86_400_000)
    : null;

  await database.query(
    `insert into platform_api_clients (
      name,token_prefix,token_hash,scopes,expires_at
     ) values ($1,$2,$3,$4,$5)`,
    [input.name, generated.tokenPrefix, generated.tokenHash, scopes, expiresAt],
  );

  console.log('Platform API token created.');
  console.log(`Client: ${input.name}`);
  console.log(`Scopes: ${scopes.join(', ')}`);
  console.log(`Expires: ${expiresAt?.toISOString() ?? 'never'}`);
  console.log('');
  console.log('Copy this value now. It cannot be recovered from the database:');
  console.log(`XIMO_POS_API_TOKEN=${generated.token}`);
} finally {
  await database.close();
}
