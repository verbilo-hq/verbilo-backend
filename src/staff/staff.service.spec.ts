import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StaffService } from './staff.service';

describe('StaffService', () => {
  let service: StaffService;
  let staffFindMany: jest.Mock;
  let staffFindFirst: jest.Mock;
  let staffCreate: jest.Mock;
  let staffUpdate: jest.Mock;

  beforeEach(() => {
    staffFindMany = jest.fn();
    staffFindFirst = jest.fn();
    staffCreate = jest.fn();
    staffUpdate = jest.fn();

    const prisma = {
      staffMember: {
        findMany: staffFindMany,
        findFirst: staffFindFirst,
        create: staffCreate,
        update: staffUpdate,
      },
    } as unknown as PrismaService;

    service = new StaffService(prisma);
  });

  it('lists staff members filtered by tenant and optional site', async () => {
    staffFindMany.mockResolvedValue([]);

    await expect(service.listStaffMembers('tenant-1', 'site-1')).resolves.toEqual(
      [],
    );

    expect(staffFindMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', archivedAt: null, siteId: 'site-1' },
      orderBy: [{ surname: 'asc' }, { firstName: 'asc' }],
    });
  });

  it('rejects duplicate staff emails within a tenant', async () => {
    staffFindFirst.mockResolvedValueOnce({ id: 'existing-staff-id' });

    await expect(
      service.createStaffMember('tenant-1', {
        firstName: 'Alice',
        surname: 'Example',
        email: 'alice@example.com',
        role: 'clinician',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(staffCreate).not.toHaveBeenCalled();
  });

  it('forwards clinicalSpecialty on create and update', async () => {
    staffFindFirst.mockResolvedValueOnce(null);
    staffCreate.mockResolvedValueOnce({ id: 'staff-1' });

    await service.createStaffMember('tenant-1', {
      firstName: 'Alice',
      surname: 'Example',
      email: 'alice@example.com',
      role: 'clinician',
      clinicalSpecialty: 'Physiotherapist',
    } as any);

    expect(staffCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinicalSpecialty: 'Physiotherapist',
      }),
    });

    staffFindFirst.mockResolvedValueOnce({ id: 'staff-1' });
    staffUpdate.mockResolvedValueOnce({ id: 'staff-1' });

    await service.updateStaffMember('tenant-1', 'staff-1', {
      clinicalSpecialty: 'Physio',
    } as any);

    expect(staffUpdate).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { clinicalSpecialty: 'Physio' },
    });
  });

  it('prevents cross-tenant access by returning not found', async () => {
    staffFindFirst.mockResolvedValueOnce(null);

    await expect(service.getStaffMember('tenant-1', 'staff-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes staff members by setting archivedAt', async () => {
    const archivedAt = new Date('2026-05-11T12:00:00.000Z');

    staffFindFirst.mockResolvedValueOnce({ id: 'staff-1' });
    staffUpdate.mockResolvedValueOnce({
      id: 'staff-1',
      tenantId: 'tenant-1',
      archivedAt,
    });

    await expect(service.archiveStaffMember('tenant-1', 'staff-1')).resolves.toEqual(
      expect.objectContaining({ id: 'staff-1', archivedAt }),
    );

    expect(staffUpdate).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it('applies partial updates', async () => {
    const startedAt = '2026-01-01T00:00:00.000Z';

    staffFindFirst.mockResolvedValueOnce({ id: 'staff-1' });
    staffUpdate.mockResolvedValueOnce({ id: 'staff-1' });

    await service.updateStaffMember('tenant-1', 'staff-1', {
      phone: '07123456789',
      startedAt,
    } as any);

    expect(staffUpdate).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: {
        phone: '07123456789',
        startedAt: new Date(startedAt),
      },
    });
  });
});
