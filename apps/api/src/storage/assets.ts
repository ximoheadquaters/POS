export interface OrganizationLogoUpload {
  organizationId: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}

export interface AssetStorage {
  uploadOrganizationLogo(input: OrganizationLogoUpload): Promise<string>;
}
