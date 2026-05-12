import { type DbUserRequestContext } from './request-context';
import { PLATFORM_ROLES, type UserRole } from './user-roles';

/**
 * The "where" half of role+scope authorization. Resolved from the
 * actor's DB row at request time.
 */
export type ActorScope =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'sites'; tenantId: string; siteIds: ReadonlySet<string> };

const TENANT_WIDE_ROLES: ReadonlySet<UserRole> = new Set([
  'company_owner',
  'company_admin',
]);

/**
 * Build the actor scope from a hydrated dbUser.
 */
export function resolveActorScope(
  dbUser: DbUserRequestContext,
): ActorScope | null {
  if (PLATFORM_ROLES.has(dbUser.role)) {
    return { kind: 'platform' };
  }
  if (!dbUser.tenantId) {
    return null;
  }
  if (TENANT_WIDE_ROLES.has(dbUser.role)) {
    return { kind: 'tenant', tenantId: dbUser.tenantId };
  }
  if (dbUser.siteIds.length > 0) {
    return {
      kind: 'sites',
      tenantId: dbUser.tenantId,
      siteIds: new Set(dbUser.siteIds),
    };
  }
  if (dbUser.siteId) {
    return {
      kind: 'sites',
      tenantId: dbUser.tenantId,
      siteIds: new Set([dbUser.siteId]),
    };
  }
  return null;
}

/**
 * Target descriptor - the entity being acted upon. tenantId is
 * required; siteId optional (some endpoints act tenant-wide).
 */
export type ActionTarget = {
  tenantId: string;
  siteId?: string | null;
};

/**
 * Returns true iff the actor's scope authorises action on the target.
 *
 * - platform: any tenant/site
 * - tenant:   target.tenantId must match
 * - sites:    target.tenantId must match AND target.siteId must be in
 *             actor.siteIds. If target has no siteId, a site-scoped
 *             actor is NOT permitted (tenant-wide ops require tenant
 *             or platform scope).
 */
export function canActOnTarget(
  actor: ActorScope,
  target: ActionTarget,
): boolean {
  if (actor.kind === 'platform') return true;
  if (actor.tenantId !== target.tenantId) return false;
  if (actor.kind === 'tenant') return true;
  if (!target.siteId) return false;
  return actor.siteIds.has(target.siteId);
}
