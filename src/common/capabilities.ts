import { type UserRole } from './user-roles';

export const CAPABILITIES = {
  TENANT_CREATE: 'tenant.create',
  TENANT_UPDATE: 'tenant.update',
  TENANT_DELETE: 'tenant.delete',
  TENANT_UPDATE_BRANDING: 'tenant.update_branding',
  USERS_LIST: 'users.list',
  USERS_CREATE: 'users.create',
  USERS_UPDATE_ROLE: 'users.update_role',
  USERS_ASSIGN_SITE: 'users.assign_site',
  USERS_DISABLE: 'users.disable',
  USERS_DELETE: 'users.delete',
  USERS_RESET_PASSWORD: 'users.reset_password',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const CAPABILITY_VALUES: ReadonlyArray<Capability> = Object.freeze(
  Object.values(CAPABILITIES) as Capability[],
);

/**
 * Role rank - higher number means more privileged. Used for privilege-
 * escalation prevention: an actor can only assign roles at or below
 * their own rank.
 */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = Object.freeze({
  employee: 10,
  practice_manager: 30,
  area_manager: 50,
  company_admin: 70,
  company_owner: 80,
  verbilo_support: 90,
  verbilo_super_admin: 100,
});

const ALL_CAPS: ReadonlySet<Capability> = new Set(CAPABILITY_VALUES);

const ROLE_CAPABILITIES: Readonly<Record<UserRole, ReadonlySet<Capability>>> =
  Object.freeze({
    verbilo_super_admin: ALL_CAPS,
    verbilo_support: new Set<Capability>([
      CAPABILITIES.TENANT_UPDATE,
      CAPABILITIES.USERS_LIST,
      CAPABILITIES.USERS_CREATE,
      CAPABILITIES.USERS_ASSIGN_SITE,
    ]),
    company_owner: new Set<Capability>([
      CAPABILITIES.TENANT_UPDATE,
      CAPABILITIES.TENANT_UPDATE_BRANDING,
      CAPABILITIES.USERS_LIST,
      CAPABILITIES.USERS_CREATE,
      CAPABILITIES.USERS_UPDATE_ROLE,
      CAPABILITIES.USERS_ASSIGN_SITE,
      CAPABILITIES.USERS_DISABLE,
      CAPABILITIES.USERS_DELETE,
      CAPABILITIES.USERS_RESET_PASSWORD,
    ]),
    company_admin: new Set<Capability>([
      CAPABILITIES.TENANT_UPDATE,
      CAPABILITIES.TENANT_UPDATE_BRANDING,
      CAPABILITIES.USERS_LIST,
      CAPABILITIES.USERS_CREATE,
      CAPABILITIES.USERS_UPDATE_ROLE,
      CAPABILITIES.USERS_ASSIGN_SITE,
      CAPABILITIES.USERS_DISABLE,
      CAPABILITIES.USERS_DELETE,
      CAPABILITIES.USERS_RESET_PASSWORD,
    ]),
    area_manager: new Set<Capability>([
      CAPABILITIES.USERS_LIST,
      CAPABILITIES.USERS_CREATE,
      CAPABILITIES.USERS_UPDATE_ROLE,
      CAPABILITIES.USERS_ASSIGN_SITE,
      CAPABILITIES.USERS_DISABLE,
      CAPABILITIES.USERS_DELETE,
      CAPABILITIES.USERS_RESET_PASSWORD,
    ]),
    practice_manager: new Set<Capability>([
      CAPABILITIES.USERS_LIST,
      CAPABILITIES.USERS_CREATE,
      CAPABILITIES.USERS_UPDATE_ROLE,
      CAPABILITIES.USERS_DISABLE,
      CAPABILITIES.USERS_DELETE,
      CAPABILITIES.USERS_RESET_PASSWORD,
    ]),
    employee: new Set<Capability>(),
  });

export function hasCapability(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

export function capabilitiesFor(role: UserRole): ReadonlySet<Capability> {
  return ROLE_CAPABILITIES[role] ?? new Set();
}

/**
 * Privilege-escalation guard.
 * An actor can act on a target ONLY if the actor's role rank is
 * strictly greater than or equal to the target role's rank.
 * Used when assigning roles + when disabling/enabling other users.
 */
export function roleRanksAtOrAbove(actor: UserRole, target: UserRole): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[target];
}
