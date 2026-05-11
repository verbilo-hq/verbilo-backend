import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type DashboardRecentActivity = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
};

export type DashboardSummary = {
  patientCount: number;
  todaysAppointments: number;
  openTasks: number;
  recentActivity: DashboardRecentActivity[];
};

type UtcDayRange = {
  start: Date;
  end: Date;
};

const getUtcDayRange = (now: Date): UtcDayRange => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  return {
    start: new Date(Date.UTC(year, month, date, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, date + 1, 0, 0, 0, 0)),
  };
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string, siteId: string | null): Promise<DashboardSummary> {
    const { start, end } = getUtcDayRange(new Date());

    const patientCountPromise = this.prisma.patient.count({
      where: {
        tenantId,
        ...(siteId ? { siteId } : {}),
      },
    });

    const todaysAppointmentsPromise = this.prisma.appointment.count({
      where: {
        startsAt: { gte: start, lt: end },
        ...(siteId
          ? { siteId, site: { tenantId } }
          : { site: { tenantId } }),
      },
    });

    // TODO: VER-?? hookup when Task model lands.
    const openTasksPromise = Promise.resolve(0);

    const recentActivityPromise = this.prisma.auditLog.findMany({
      where: { tenantId },
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

    const [patientCount, todaysAppointments, openTasks, recentActivity] =
      await Promise.all([
        patientCountPromise,
        todaysAppointmentsPromise,
        openTasksPromise,
        recentActivityPromise,
      ]);

    return {
      patientCount,
      todaysAppointments,
      openTasks,
      recentActivity,
    };
  }
}

