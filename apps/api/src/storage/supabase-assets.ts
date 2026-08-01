import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { serviceUnavailable } from '../shared/errors.js';
import type { AssetStorage } from './assets.js';

const extensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export function createSupabaseAssetStorage(config: AppConfig): AssetStorage {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async uploadOrganizationLogo(input) {
      const extension = extensions[input.mimeType];
      const path = `${input.organizationId}/organization/logo.${extension}`;
      const { error } = await client.storage
        .from(config.SUPABASE_STORAGE_BUCKET)
        .upload(path, input.bytes, {
          contentType: input.mimeType,
          upsert: true,
          cacheControl: '3600',
        });
      if (error) {
        throw serviceUnavailable(
          'ORGANIZATION_LOGO_UPLOAD_FAILED',
          'The organization logo could not be uploaded. Please try again.',
        );
      }
      const { data } = client.storage.from(config.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
      return `${data.publicUrl}?v=${Date.now()}`;
    },
  };
}
