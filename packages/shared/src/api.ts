import type { BusinessProfile, ModuleCode, Permission, RoleCode } from './constants.js';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    requestId?: string;
  };
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type ApplicationCode = 'ximo_pos' | (string & {});
export type EntitlementValue = boolean | number | string | null | Record<string, unknown>;

export interface ApplicationAccess {
  id: string;
  code: ApplicationCode;
  name: string;
  subscriptionStatus: string;
  planCode: string | null;
  planName: string | null;
  role: RoleCode | string | null;
  entitlements: Record<string, EntitlementValue>;
}

export interface OrganizationMembershipSummary {
  id: string;
  organizationId: string;
  status: 'invited' | 'active' | 'suspended' | 'removed';
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  organization: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    businessProfile: BusinessProfile;
    subscriptionStatus: string;
  };
  role: RoleCode;
  permissions: Permission[];
  modules: ModuleCode[];
  branches: Array<{ id: string; name: string; code: string }>;
  /** Platform membership. Optional until migration 0032 is deployed everywhere. */
  membership?: OrganizationMembershipSummary;
  /** Access to Ximo POS and any future Ximo applications for this organization. */
  applications?: ApplicationAccess[];
  /** True while an owner is still using an administrator-generated password. */
  mustChangePassword?: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
