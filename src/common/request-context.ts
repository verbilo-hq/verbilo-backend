import { UserRole } from './user-roles';

export type TenantRequestContext = {
  id: string;
  slug: string;
  name: string;
  sector: string;
  enabledModules: string[];
};

export type TenantSlugSource = 'header' | 'host';

export type ActingInTenantContext = TenantRequestContext;

export type DbUserRequestContext = {
  id: string;
  cognitoId: string;
  tenantId: string | null;
  siteId: string | null;
  siteIds: string[];
  role: UserRole;
};
