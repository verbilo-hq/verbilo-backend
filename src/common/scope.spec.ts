import { type DbUserRequestContext } from './request-context';
import { canActOnTarget, resolveActorScope } from './scope';
import { USER_ROLES, type UserRole } from './user-roles';

function dbUser(
  role: UserRole,
  overrides: Partial<DbUserRequestContext> = {},
): DbUserRequestContext {
  return {
    id: `${role}-id`,
    cognitoId: `${role}-cognito`,
    role,
    tenantId: 'tenant-1',
    siteId: 'site-1',
    siteIds: ['site-1'],
    ...overrides,
  };
}

describe('scope', () => {
  it('resolves actor scope for each role', () => {
    const expected = {
      employee: {
        kind: 'sites',
        tenantId: 'tenant-1',
        siteIds: new Set(['site-1']),
      },
      practice_manager: {
        kind: 'sites',
        tenantId: 'tenant-1',
        siteIds: new Set(['site-1']),
      },
      area_manager: {
        kind: 'sites',
        tenantId: 'tenant-1',
        siteIds: new Set(['site-1']),
      },
      company_admin: { kind: 'tenant', tenantId: 'tenant-1' },
      company_owner: { kind: 'tenant', tenantId: 'tenant-1' },
      verbilo_support: { kind: 'platform' },
      verbilo_super_admin: { kind: 'platform' },
    } as const;

    for (const role of USER_ROLES) {
      expect(resolveActorScope(dbUser(role))).toEqual(expected[role]);
    }
  });

  it('returns null for malformed non-platform users without tenant or site scope', () => {
    expect(resolveActorScope(dbUser('company_admin', { tenantId: null }))).toBe(
      null,
    );
    expect(
      resolveActorScope(dbUser('area_manager', { siteId: null, siteIds: [] })),
    ).toBe(null);
    expect(
      resolveActorScope(
        dbUser('practice_manager', { siteId: null, siteIds: [] }),
      ),
    ).toBe(null);
    expect(
      resolveActorScope(dbUser('employee', { siteId: null, siteIds: [] })),
    ).toBe(null);
  });

  it('falls back to legacy siteId when assignments are missing', () => {
    expect(resolveActorScope(dbUser('area_manager', { siteIds: [] }))).toEqual({
      kind: 'sites',
      tenantId: 'tenant-1',
      siteIds: new Set(['site-1']),
    });
  });

  it('allows platform scope to target any tenant or site', () => {
    expect(canActOnTarget({ kind: 'platform' }, { tenantId: 'tenant-2' })).toBe(
      true,
    );
    expect(
      canActOnTarget(
        { kind: 'platform' },
        { tenantId: 'tenant-2', siteId: 'site-9' },
      ),
    ).toBe(true);
  });

  it('allows tenant scope only inside the same tenant', () => {
    const actor = { kind: 'tenant', tenantId: 'tenant-1' } as const;

    expect(canActOnTarget(actor, { tenantId: 'tenant-1' })).toBe(true);
    expect(
      canActOnTarget(actor, { tenantId: 'tenant-1', siteId: 'site-2' }),
    ).toBe(true);
    expect(canActOnTarget(actor, { tenantId: 'tenant-2' })).toBe(false);
  });

  it('allows sites scope for any assigned explicit site in the same tenant', () => {
    const actor = {
      kind: 'sites',
      tenantId: 'tenant-1',
      siteIds: new Set(['site-1', 'site-2']),
    } as const;

    expect(
      canActOnTarget(actor, { tenantId: 'tenant-1', siteId: 'site-1' }),
    ).toBe(true);
    expect(
      canActOnTarget(actor, { tenantId: 'tenant-1', siteId: 'site-2' }),
    ).toBe(true);
    expect(
      canActOnTarget(actor, { tenantId: 'tenant-1', siteId: 'site-3' }),
    ).toBe(false);
    expect(canActOnTarget(actor, { tenantId: 'tenant-1' })).toBe(false);
    expect(
      canActOnTarget(actor, { tenantId: 'tenant-2', siteId: 'site-1' }),
    ).toBe(false);
  });
});
