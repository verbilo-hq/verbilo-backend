import { type DbUserRequestContext } from './request-context';
import { type UserRole } from './user-roles';

/**
 * The "where" half of role+scope authorization. Resolved from the
 * actor's DB row at request time.
 */
export type ActorScope =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'site'; tenantId: string; siteId: string };

const PLATFORM_ROLES: ReadonlySet<UserRole> = new Set([
  'verbilo_super_admin',
  'verbilo_support',
]);
const TENANT_WIDE_ROLES: ReadonlySet<UserRole> = new Set([
  'company_owner',
  'company_admin',
]);

/**
 * Build the actor scope from a hydrated dbUser. Phase 1 treats
 * `area_manager` and `practice_manager` both as { kind: 'site' } scoped
 * to their single `User.siteId`; Phase 2 (VER-58) adds proper multi-
 * site assignment.
 */
export function resolveActorScope(
  dbUser: DbUserRequestContext,
): ActorScope | null {
  if (PLATFORM_ROLES.has(dbUser.role as UserRole)) {
    return { kind: 'platform' };
  }
  if (!dbUser.tenantId) {
    return null;
  }
  if (TENANT_WIDE_ROLES.has(dbUser.role as UserRole)) {
    return { kind: 'tenant', tenantId: dbUser.tenantId };
  }
  if (!dbUser.siteId) return null;
  return { kind: 'site', tenantId: dbUser.tenantId, siteId: dbUser.siteId };
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
 * - site:     target.tenantId must match AND target.siteId (if set)
 *             must equal actor.siteId. If target has no siteId, a
 *             site-scoped actor is NOT permitted (tenant-wide ops
 *             require tenant or platform scope).
 */
export function canActOnTarget(
  actor: ActorScope,
  target: ActionTarget,
): boolean {
  if (actor.kind === 'platform') return true;
  if (actor.tenantId !== target.tenantId) return false;
  if (actor.kind === 'tenant') return true;
  if (!target.siteId) return false;
  return actor.siteId === target.siteId;
}
