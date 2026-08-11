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
  /** True while an owner is still using an administrator-generated password. */
  mustChangePassword?: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
