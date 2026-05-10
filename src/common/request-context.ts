import { UserRole } from './user-roles';

export type TenantRequestContext = {
  id: string;
  slug: string;
  name: string;
  sector: string;
  enabledModules: string[];
};

export type DbUserRequestContext = {
  id: string;
  cognitoId: string;
  tenantId: string;
  siteId: string | null;
  role: UserRole;
};
