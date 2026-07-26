import { createHash, randomBytes } from 'node:crypto';

const TOKEN_PREFIX = 'ximo_platform_';

export function hashPlatformToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createPlatformToken(): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    token,
    tokenHash: hashPlatformToken(token),
    tokenPrefix: token.slice(0, 24),
  };
}

export function isPlatformToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length >= TOKEN_PREFIX.length + 40;
}
