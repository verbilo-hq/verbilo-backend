import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { CAPABILITY_VALUES } from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';

describe('UsersService', () => {
  let service: UsersService;
  let userFindFirst: jest.Mock;
  let staffFindFirst: jest.Mock;
  let auditFindMany: jest.Mock;
  let transaction: jest.Mock;
  let txUserFindFirst: jest.Mock;
  let txUserUpdate: jest.Mock;
  let txStaffFindFirst: jest.Mock;
  let txStaffUpdate: jest.Mock;
  let txAuditCreate: jest.Mock;

  beforeEach(() => {
    userFindFirst = jest.fn();
    staffFindFirst = jest.fn();
    auditFindMany = jest.fn();

    txUserFindFirst = jest.fn();
    txUserUpdate = jest.fn();
    txStaffFindFirst = jest.fn();
    txStaffUpdate = jest.fn();
    txAuditCreate = jest.fn();

    const tx = {
      user: {
        findFirst: txUserFindFirst,
        update: txUserUpdate,
      },
      staffMember: {
        findFirst: txStaffFindFirst,
        update: txStaffUpdate,
      },
      auditLog: {
        create: txAuditCreate,
      },
    };

    transaction = jest.fn(async (fn: any) => fn(tx));

    const prisma = {
      user: { findFirst: userFindFirst },
      staffMember: { findFirst: staffFindFirst },
      auditLog: { findMany: auditFindMany },
      $transaction: transaction,
    } as unknown as PrismaService;

    service = new UsersService(prisma);
  });

  function dbUser(
    role: DbUserRequestContext['role'],
    overrides: Partial<DbUserRequestContext> = {},
  ): DbUserRequestContext {
    return {
      id: 'user-1',
      cognitoId: 'cognito-sub-1',
      tenantId: 'tenant-1',
      siteId: null,
      siteIds: [],
      role,
      ...overrides,
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getMyPermissions', () => {
    it('returns all capabilities and platform scope for verbilo_super_admin', async () => {
      await expect(
        service.getMyPermissions(
          dbUser('verbilo_super_admin', { tenantId: null }),
        ),
      ).resolves.toEqual({
        role: 'verbilo_super_admin',
        capabilities: [...CAPABILITY_VALUES].sort(),
        scope: { kind: 'platform' },
        isPlatformAdmin: true,
      });
    });

    it('returns tenant-scoped capabilities for company_admin', async () => {
      await expect(
        service.getMyPermissions(dbUser('company_admin')),
      ).resolves.toEqual({
        role: 'company_admin',
        capabilities: [
          'tenant.update',
          'tenant.update_branding',
          'users.assign_site',
          'users.create',
          'users.delete',
          'users.disable',
          'users.list',
          'users.reset_password',
          'users.update_role',
        ].sort(),
        scope: { kind: 'tenant', tenantId: 'tenant-1' },
        isPlatformAdmin: false,
      });
    });

    it('returns sorted site-scoped permissions for area_manager assignments', async () => {
      await expect(
        service.getMyPermissions(
          dbUser('area_manager', { siteIds: ['site-2', 'site-1'] }),
        ),
      ).resolves.toEqual({
        role: 'area_manager',
        capabilities: [
          'users.assign_site',
          'users.create',
          'users.delete',
          'users.disable',
          'users.list',
          'users.reset_password',
          'users.update_role',
        ].sort(),
        scope: {
          kind: 'sites',
          tenantId: 'tenant-1',
          siteIds: ['site-1', 'site-2'],
        },
        isPlatformAdmin: false,
      });
    });

    it('returns empty capabilities and no scope for employee with no assignments', async () => {
      await expect(
        service.getMyPermissions(
          dbUser('employee', { siteId: null, siteIds: [] }),
        ),
      ).resolves.toEqual({
        role: 'employee',
        capabilities: [],
        scope: { kind: 'none' },
        isPlatformAdmin: false,
      });
    });
  });

  it('export returns expected shape with non-null user / tenant / site', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

    userFindFirst.mockResolvedValueOnce({
      id: 'user-1',
      username: 'alice',
      cognitoId: 'cognito-sub-1',
      role: 'employee',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      deletedAt: null,
      tenant: {
        id: 'tenant-1',
        name: 'Tenant',
        slug: 'tenant',
        sector: 'dental',
      },
      site: { id: 'site-1', name: 'Site' },
    });

    staffFindFirst.mockResolvedValueOnce({
      id: 'staff-1',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      userId: 'user-1',
      firstName: 'Alice',
      surname: 'Example',
      email: 'alice@example.com',
      phone: null,
      role: 'clinician',
      clinicalSpecialty: 'Dentist',
      gdcNumber: null,
      startedAt: null,
      endedAt: null,
      archivedAt: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    auditFindMany.mockResolvedValueOnce([
      {
        id: 'audit-1',
        action: 'post.staff',
        entityType: 'staff',
        entityId: 'staff-1',
        createdAt: new Date('2026-05-11T11:00:00.000Z'),
      },
    ]);

    await expect(service.exportMyData('cognito-sub-1')).resolves.toEqual({
      exportedAt: '2026-05-11T12:00:00.000Z',
      user: {
        id: 'user-1',
        username: 'alice',
        cognitoId: 'cognito-sub-1',
        role: 'employee',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        deletedAt: null,
      },
      tenant: {
        id: 'tenant-1',
        name: 'Tenant',
        slug: 'tenant',
        sector: 'dental',
      },
      site: { id: 'site-1', name: 'Site' },
      staffMember: expect.objectContaining({ id: 'staff-1' }),
      auditLog: [
        {
          id: 'audit-1',
          action: 'post.staff',
          entityType: 'staff',
          entityId: 'staff-1',
          createdAt: new Date('2026-05-11T11:00:00.000Z'),
        },
      ],
    });
  });

  it('export returns null staffMember when no link', async () => {
    userFindFirst.mockResolvedValueOnce({
      id: 'user-1',
      username: 'alice',
      cognitoId: 'cognito-sub-1',
      role: 'employee',
      tenantId: 'tenant-1',
      siteId: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      deletedAt: null,
      tenant: {
        id: 'tenant-1',
        name: 'Tenant',
        slug: 'tenant',
        sector: 'dental',
      },
      site: null,
    });

    staffFindFirst.mockResolvedValueOnce(null);
    auditFindMany.mockResolvedValueOnce([]);

    const result = await service.exportMyData('cognito-sub-1');
    expect(result.staffMember).toBeNull();
  });

  it('delete sets deletedAt, anonymises username, nulls cognitoId', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-11T13:00:00.000Z'));

    txUserFindFirst.mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      deletedAt: null,
    });

    txStaffFindFirst.mockResolvedValueOnce(null);

    await expect(
      service.deleteMyData('cognito-sub-1'),
    ).resolves.toBeUndefined();

    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        deletedAt: new Date('2026-05-11T13:00:00.000Z'),
        cognitoId: null,
        username: 'deleted-user-1',
        siteId: null,
      },
    });

    expect(txAuditCreate).toHaveBeenCalled();
  });

  it('delete is idempotent (running twice does not error)', async () => {
    txUserFindFirst
      .mockResolvedValueOnce({
        id: 'user-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'user-1',
        tenantId: 'tenant-1',
        deletedAt: new Date('2026-05-11T13:00:00.000Z'),
      });

    txStaffFindFirst.mockResolvedValue(null);

    await service.deleteMyData('cognito-sub-1');
    await service.deleteMyData('cognito-sub-1');
  });

  it('delete writes an AuditLog entry', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-11T14:00:00.000Z'));

    txUserFindFirst.mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      deletedAt: null,
    });

    txStaffFindFirst.mockResolvedValueOnce(null);

    await service.deleteMyData('cognito-sub-1');

    expect(txAuditCreate).toHaveBeenCalledWith({
      data: {
        action: 'user.deleted',
        entityType: 'User',
        entityId: 'user-1',
        actorUserId: 'user-1',
        tenantId: 'tenant-1',
        payloadJson: { reason: 'gdpr_self_delete' },
      },
    });
  });

  it('delete anonymises linked StaffMember (email rewritten, archivedAt set)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-11T15:00:00.000Z'));

    txUserFindFirst.mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      deletedAt: null,
    });

    txStaffFindFirst.mockResolvedValueOnce({ id: 'staff-1' });

    await service.deleteMyData('cognito-sub-1');

    expect(txStaffUpdate).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: {
        archivedAt: new Date('2026-05-11T15:00:00.000Z'),
        email: 'deleted+staff-1@verbilo.invalid',
        phone: null,
      },
    });
  });
});
