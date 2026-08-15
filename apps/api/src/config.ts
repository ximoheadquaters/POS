import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: z.enum(['true', 'false']).default('false'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(10).default(4),
    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_STORAGE_BUCKET: z.string().default('product-images'),
    PLATFORM_OWNER_INVITE_REDIRECT_URL: z.url(),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((environment, context) => {
    const redirect = new URL(environment.PLATFORM_OWNER_INVITE_REDIRECT_URL);
    if (environment.NODE_ENV === 'production' && redirect.protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['PLATFORM_OWNER_INVITE_REDIRECT_URL'],
        message: 'Production owner invitations require an HTTPS redirect URL',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid API environment configuration:\n${issues}`);
  }
  return result.data;
}
