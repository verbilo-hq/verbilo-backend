import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

describe('StaffController', () => {
  let controller: StaffController;
  let staffService: {
    listStaffMembers: jest.Mock;
    createStaffMember: jest.Mock;
  };

  beforeEach(async () => {
    staffService = {
      listStaffMembers: jest.fn(),
      createStaffMember: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [StaffController],
      providers: [{ provide: StaffService, useValue: staffService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(StaffController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns list responses with the expected shape', async () => {
    staffService.listStaffMembers.mockResolvedValueOnce([
      {
        id: 'staff-1',
        tenantId: 'tenant-1',
        siteId: null,
        userId: null,
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
        createdAt: new Date('2026-05-11T10:00:00.000Z'),
        updatedAt: new Date('2026-05-11T10:00:00.000Z'),
        unexpectedField: 'should-not-serialize',
      },
    ]);

    const result = await controller.listStaff(
      { siteId: undefined } as any,
      { dbUser: { tenantId: 'tenant-1' } } as any,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'staff-1',
        tenantId: 'tenant-1',
        email: 'alice@example.com',
      }),
    );
    expect((result[0] as any).unexpectedField).toBeUndefined();
  });

  it('returns create responses with the expected shape', async () => {
    staffService.createStaffMember.mockResolvedValueOnce({
      id: 'staff-1',
      tenantId: 'tenant-1',
      siteId: null,
      userId: null,
      firstName: 'Alice',
      surname: 'Example',
      email: 'alice@example.com',
      phone: null,
      role: 'clinician',
      clinicalSpecialty: 'Physiotherapist',
      gdcNumber: null,
      startedAt: null,
      endedAt: null,
      archivedAt: null,
      createdAt: new Date('2026-05-11T10:00:00.000Z'),
      updatedAt: new Date('2026-05-11T10:00:00.000Z'),
      unexpectedField: 'should-not-serialize',
    });

    const body = {
      firstName: 'Alice',
      surname: 'Example',
      email: 'alice@example.com',
      role: 'clinician',
      clinicalSpecialty: 'Physiotherapist',
    };

    const result = await controller.createStaff(body as any, {
      dbUser: { tenantId: 'tenant-1' },
    } as any);

    expect(staffService.createStaffMember).toHaveBeenCalledWith('tenant-1', body);
    expect(result).toEqual(
      expect.objectContaining({
        id: 'staff-1',
        email: 'alice@example.com',
      }),
    );
    expect((result as any).unexpectedField).toBeUndefined();
  });
});
