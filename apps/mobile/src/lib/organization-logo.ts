import { appStorage } from './storage';

interface CachedOrganizationLogo {
  remoteUrl: string | null;
  dataUrl: string;
}

function cacheKey(organizationId: string): string {
  return `ximo.organization-logo.v1.${organizationId}`;
}

export async function getCachedOrganizationLogo(
  organizationId: string,
): Promise<CachedOrganizationLogo | null> {
  const stored = await appStorage.getItem(cacheKey(organizationId));
  if (!stored) return null;
  try {
    return JSON.parse(stored) as CachedOrganizationLogo;
  } catch {
    await appStorage.removeItem(cacheKey(organizationId));
    return null;
  }
}

export async function saveCachedOrganizationLogo(
  organizationId: string,
  logo: CachedOrganizationLogo,
): Promise<void> {
  await appStorage.setItem(cacheKey(organizationId), JSON.stringify(logo));
}

export async function removeCachedOrganizationLogo(organizationId: string): Promise<void> {
  await appStorage.removeItem(cacheKey(organizationId));
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The organization logo could not be cached.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function cacheRemoteOrganizationLogo(
  organizationId: string,
  remoteUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(remoteUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 2_000_000) return null;
    const dataUrl = await blobAsDataUrl(blob);
    await saveCachedOrganizationLogo(organizationId, { remoteUrl, dataUrl });
    return dataUrl;
  } catch {
    return null;
  }
}
