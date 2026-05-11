import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  it('resolves the caller user and forwards tenantId + siteId to the service', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: 'tenant-id',
          siteId: 'site-id',
        }),
      },
    };

    const dashboardService = {
      getSummary: jest.fn().mockResolvedValue({
        patientCount: 1,
        todaysAppointments: 2,
        openTasks: 0,
        recentActivity: [],
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: DashboardService, useValue: dashboardService },
      ],
    }).compile();

    const controller = moduleRef.get(DashboardController);

    const request = { user: { sub: 'cognito-sub' } };
    await controller.getSummary(request as any);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { cognitoId: 'cognito-sub' },
      select: { tenantId: true, siteId: true },
    });
    expect(dashboardService.getSummary).toHaveBeenCalledWith(
      'tenant-id',
      'site-id',
    );
  });

  it('throws 404 when the user cannot be resolved', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const dashboardService = {
      getSummary: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: DashboardService, useValue: dashboardService },
      ],
    }).compile();

    const controller = moduleRef.get(DashboardController);

    await expect(
      controller.getSummary({ user: { sub: 'cognito-sub' } } as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(dashboardService.getSummary).not.toHaveBeenCalled();
  });

  it('throws 403 when the caller has no tenant context', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: null,
          siteId: null,
        }),
      },
    };

    const dashboardService = {
      getSummary: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: DashboardService, useValue: dashboardService },
      ],
    }).compile();

    const controller = moduleRef.get(DashboardController);

    await expect(
      controller.getSummary({ user: { sub: 'cognito-sub' } } as any),
    ).rejects.toThrow('Platform admin must act on a specific tenant context');

    expect(dashboardService.getSummary).not.toHaveBeenCalled();
  });
});
