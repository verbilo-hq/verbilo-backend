import { ForbiddenException } from '@nestjs/common';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const otherTenantId = '33333333-3333-4333-8333-333333333333';
  const logId = '44444444-4444-4444-8444-444444444444';

  function service() {
    const prisma = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
    };

    return {
      prisma,
      auditService: new AuditService(prisma as never),
    };
  }

  it('forces tenant-scoped callers onto their own tenant and flattens actors', async () => {
    const { prisma, auditService } = service();
    const createdAt = new Date('2026-05-14T10:00:00.000Z');

    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: logId,
        actorUserId: actorId,
        tenantId,
        action: 'tenant.updated',
        entityType: 'tenant',
        entityId: tenantId,
        payloadJson: { changed: true },
        createdAt,
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: actorId,
        username: 'admin',
        displayName: 'Admin User',
      },
    ]);

    const result = await auditService.list({
      callerTenantId: tenantId,
      isPlatformAdmin: false,
      tenantId: otherTenantId,
      limit: 50,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { AND: [{ tenantId }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    expect(result).toEqual({
      items: [
        {
          id: logId,
          actorUserId: actorId,
          tenantId,
          action: 'tenant.updated',
          entityType: 'tenant',
          entityId: tenantId,
          payload: { changed: true },
          createdAt,
          actor: {
            id: actorId,
            username: 'admin',
            displayName: 'Admin User',
          },
        },
      ],
      nextCursor: null,
    });
  });

  it('allows platform admins to filter tenantId and paginate by cursor', async () => {
    const { prisma, auditService } = service();
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-05-14T10:00:00.000Z',
        id: logId,
      }),
    ).toString('base64');

    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    await auditService.list({
      callerTenantId: null,
      isPlatformAdmin: true,
      tenantId,
      cursor,
      limit: 25,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { tenantId },
          {
            OR: [
              { createdAt: { lt: new Date('2026-05-14T10:00:00.000Z') } },
              {
                createdAt: new Date('2026-05-14T10:00:00.000Z'),
                id: { lt: logId },
              },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
    });
  });

  it('rejects tenant-scoped audit reads without a caller tenant', async () => {
    const { auditService } = service();

    await expect(
      auditService.list({
        callerTenantId: null,
        isPlatformAdmin: false,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
