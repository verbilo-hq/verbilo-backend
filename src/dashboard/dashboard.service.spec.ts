import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let patientCount: jest.Mock;
  let appointmentCount: jest.Mock;
  let auditFindMany: jest.Mock;

  beforeEach(() => {
    patientCount = jest.fn();
    appointmentCount = jest.fn();
    auditFindMany = jest.fn();

    const prisma = {
      patient: { count: patientCount },
      appointment: { count: appointmentCount },
      auditLog: { findMany: auditFindMany },
    } as unknown as PrismaService;

    service = new DashboardService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns zeros + empty array when no data', async () => {
    patientCount.mockResolvedValue(0);
    appointmentCount.mockResolvedValue(0);
    auditFindMany.mockResolvedValue([]);

    await expect(service.getSummary('tenant-id', null)).resolves.toEqual({
      patientCount: 0,
      todaysAppointments: 0,
      openTasks: 0,
      recentActivity: [],
    });
  });

  it("includes today's appointments only (UTC boundaries)", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-11T10:15:00.000Z'));

    patientCount.mockResolvedValue(0);
    appointmentCount.mockResolvedValue(5);
    auditFindMany.mockResolvedValue([]);

    await expect(service.getSummary('tenant-id', null)).resolves.toEqual({
      patientCount: 0,
      todaysAppointments: 5,
      openTasks: 0,
      recentActivity: [],
    });

    const appointmentArgs = appointmentCount.mock.calls[0]?.[0];
    expect(appointmentArgs).toBeDefined();
    expect(appointmentArgs.where.site).toEqual({ tenantId: 'tenant-id' });
    expect(appointmentArgs.where.startsAt.gte).toEqual(
      new Date('2026-05-11T00:00:00.000Z'),
    );
    expect(appointmentArgs.where.startsAt.lt).toEqual(
      new Date('2026-05-12T00:00:00.000Z'),
    );
  });

  it('filters patient count by site when siteId set; tenant-wide when null', async () => {
    patientCount.mockResolvedValueOnce(2).mockResolvedValueOnce(7);
    appointmentCount.mockResolvedValue(0);
    auditFindMany.mockResolvedValue([]);

    await expect(service.getSummary('tenant-id', 'site-id')).resolves.toEqual(
      expect.objectContaining({ patientCount: 2 }),
    );
    expect(patientCount).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-id', siteId: 'site-id' },
    });

    await expect(service.getSummary('tenant-id', null)).resolves.toEqual(
      expect.objectContaining({ patientCount: 7 }),
    );

    expect(patientCount).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-id' },
    });
  });

  it('returns at most 10 audit log entries, newest first', async () => {
    patientCount.mockResolvedValue(0);
    appointmentCount.mockResolvedValue(0);
    auditFindMany.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'a',
        entityType: 'tenant',
        entityId: null,
        createdAt: new Date('2026-05-11T11:00:00.000Z'),
      },
    ]);

    const result = await service.getSummary('tenant-id', null);

    expect(auditFindMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-id' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
      },
    });
    expect(result.recentActivity).toHaveLength(1);
    expect(result.recentActivity[0].id).toBe('audit-1');
  });
});

