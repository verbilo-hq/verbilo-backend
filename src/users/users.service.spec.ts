import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

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

  afterEach(() => {
    jest.useRealTimers();
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
      tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant', sector: 'dental' },
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
      role: 'dentist',
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
      tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant', sector: 'dental' },
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
      tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant', sector: 'dental' },
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

    await expect(service.deleteMyData('cognito-sub-1')).resolves.toBeUndefined();

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
