export const USER_ROLES = Object.freeze([
  'employee',
  'practice_manager',
  'area_manager',
  'company_admin',
  'company_owner',
  'verbilo_support',
  'verbilo_super_admin',
] as const);

export type UserRole = (typeof USER_ROLES)[number];

const USER_ROLE_SET: ReadonlySet<string> = new Set(USER_ROLES);

export const PLATFORM_ROLES: ReadonlySet<UserRole> = new Set([
  'verbilo_super_admin',
  'verbilo_support',
]);

export function isUserRole(role: string): role is UserRole {
  return USER_ROLE_SET.has(role);
}
