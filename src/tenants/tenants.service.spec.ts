import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from './tenants.service';

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantFindUnique: jest.Mock;
  let tenantCreate: jest.Mock;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    tenantFindUnique = jest.fn();
    tenantCreate = jest.fn();
    auditRecord = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      tenant: {
        findUnique: tenantFindUnique,
        create: tenantCreate,
      },
    } as unknown as PrismaService;

    const audit = {
      record: auditRecord,
    } as unknown as AuditService;

    service = new TenantsService(prisma, audit);
  });

  it('rejects invalid slugs before checking the database', async () => {
    await expect(
      service.createTenant({
        name: 'Acme Dental',
        slug: 'ab',
        sector: 'dental',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(tenantCreate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('rejects reserved slugs before checking the database', async () => {
    await expect(
      service.createTenant({
        name: 'Admin Dental',
        slug: 'admin',
        sector: 'dental',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(tenantCreate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('rejects taken slugs', async () => {
    tenantFindUnique.mockResolvedValue({ id: 'existing-tenant-id' });

    await expect(
      service.createTenant({
        name: 'Taken Dental',
        slug: 'taken-dental',
        sector: 'dental',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { slug: 'taken-dental' },
      select: { id: true },
    });
    expect(tenantCreate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('creates tenants with a normalized slug and writes an audit row', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(null);
    tenantCreate.mockResolvedValue(tenant);

    await expect(
      service.createTenant(
        {
          name: ' Acme Dental ',
          slug: 'ACME Dental',
          sector: 'dental',
          enabledModules: ['documents'],
        },
        'actor-user-id',
      ),
    ).resolves.toEqual({
      ...tenant,
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(tenantCreate).toHaveBeenCalledWith({
      data: {
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: ['documents'],
      },
    });
    expect(auditRecord).toHaveBeenCalledWith({
      actorUserId: 'actor-user-id',
      tenantId: 'tenant-id',
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: ['documents'],
      },
    });
  });
});
